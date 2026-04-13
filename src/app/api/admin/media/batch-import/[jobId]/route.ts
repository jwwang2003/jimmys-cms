import { NextResponse } from "next/server";

import { canEdit } from "@/lib/authz";
import { readBatchIngestJob } from "@/lib/media/ingest-jobs";
import { getCurrentSession } from "@/lib/session";

export const runtime = "nodejs";

function getJobId(raw: string) {
    const jobId = Number(raw);
    if (!Number.isFinite(jobId)) {
        throw new Error("Invalid batch ingest job id");
    }
    return jobId;
}

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
    const session = await getCurrentSession();
    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canEdit(session.role)) {
        return NextResponse.json({ error: "Guests have read-only access" }, { status: 403 });
    }

    const { jobId } = await context.params;
    const snapshot = readBatchIngestJob(getJobId(jobId));
    return NextResponse.json({ ok: true, snapshot });
}
