import { canEdit } from "@/lib/authz";
import { isBatchIngestJobTerminal, readBatchIngestJob } from "@/lib/media/ingest-jobs";
import { getCurrentSession } from "@/lib/session";

export const runtime = "nodejs";

function getJobId(raw: string) {
    const jobId = Number(raw);
    if (!Number.isFinite(jobId)) {
        throw new Error("Invalid batch ingest job id");
    }
    return jobId;
}

function encodeSseEvent(name: string, payload: unknown) {
    return `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
    const session = await getCurrentSession();
    if (!session) {
        return new Response("Unauthorized", { status: 401 });
    }
    if (!canEdit(session.role)) {
        return new Response("Guests have read-only access", { status: 403 });
    }

    const { jobId: rawJobId } = await context.params;
    const jobId = getJobId(rawJobId);
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            let closed = false;
            let previousPayload = "";

            const emitSnapshot = (eventName = "job") => {
                const snapshot = readBatchIngestJob(jobId);
                const serialized = JSON.stringify(snapshot);
                if (serialized !== previousPayload || eventName === "snapshot") {
                    previousPayload = serialized;
                    controller.enqueue(encoder.encode(encodeSseEvent(eventName, snapshot)));
                }

                if (isBatchIngestJobTerminal(jobId)) {
                    controller.enqueue(encoder.encode(encodeSseEvent("complete", snapshot)));
                    controller.close();
                    closed = true;
                    return true;
                }
                return false;
            };

            emitSnapshot("snapshot");

            const interval = setInterval(() => {
                if (closed) return;
                try {
                    if (emitSnapshot("job")) {
                        clearInterval(interval);
                    }
                } catch (error) {
                    controller.enqueue(
                        encoder.encode(
                            encodeSseEvent("error", {
                                error: error instanceof Error ? error.message : "Batch ingest event stream failed",
                            })
                        )
                    );
                    clearInterval(interval);
                    controller.close();
                    closed = true;
                }
            }, 500);

            const ping = setInterval(() => {
                if (closed) return;
                controller.enqueue(encoder.encode(": keep-alive\n\n"));
            }, 15000);

            return () => {
                clearInterval(interval);
                clearInterval(ping);
            };
        },
        cancel() {
            return undefined;
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
        },
    });
}
