import { canEdit } from "@/lib/authz";
import { isBatchIngestJobTerminal, readBatchIngestJob } from "@/lib/media/ingest-jobs";
import { getCurrentSession } from "@/lib/session";

export const runtime = "nodejs";

function getJobId(raw: string) {
    const jobId = Number(raw);
    return Number.isFinite(jobId) ? jobId : null;
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
    if (jobId === null) {
        return new Response("Invalid batch ingest job id", { status: 400 });
    }
    const encoder = new TextEncoder();

    // Timer teardown must live in cancel(): the Streams API ignores start()'s
    // return value, so cleanup returned from there never runs and every
    // disconnected client would leave its intervals firing for the life of
    // the process.
    let closed = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
        closed = true;
        if (interval) clearInterval(interval);
        if (ping) clearInterval(ping);
    };

    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
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
                    stop();
                    controller.close();
                    return true;
                }
                return false;
            };

            emitSnapshot("snapshot");

            interval = setInterval(() => {
                if (closed) return;
                try {
                    emitSnapshot("job");
                } catch (error) {
                    controller.enqueue(
                        encoder.encode(
                            encodeSseEvent("error", {
                                error: error instanceof Error ? error.message : "Batch ingest event stream failed",
                            })
                        )
                    );
                    stop();
                    controller.close();
                }
            }, 500);

            ping = setInterval(() => {
                if (closed) return;
                controller.enqueue(encoder.encode(": keep-alive\n\n"));
            }, 15000);
        },
        cancel() {
            stop();
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
