import { NextResponse } from "next/server";

import { canEdit } from "@/lib/authz";
import { getCurrentSession } from "@/lib/session";
import { hasGoogleMapsKey } from "@/lib/google-maps";
import { createAndRunBatchIngestJob } from "@/lib/media/ingest-jobs";
import { readSpreadsheetUpload } from "@/lib/media/spreadsheet-upload";

export const runtime = "nodejs";

export async function POST(request: Request) {
    const session = await getCurrentSession();
    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canEdit(session.role)) {
        return NextResponse.json({ error: "Guests have read-only access" }, { status: 403 });
    }

    try {
        const form = await request.formData();
        const spreadsheetFile = form.get("spreadsheet");
        if (!(spreadsheetFile instanceof File)) {
            return NextResponse.json({ error: "Missing spreadsheet file upload" }, { status: 400 });
        }

        const files = form
            .getAll("files")
            .filter((item): item is File => item instanceof File && item.size > 0);
        if (files.length === 0) {
            return NextResponse.json({ error: "Select at least one media file" }, { status: 400 });
        }

        const spreadsheet = await readSpreadsheetUpload(spreadsheetFile);
        const job = await createAndRunBatchIngestJob({
            spreadsheet,
            files: await Promise.all(
                files.map(async (file) => ({
                    fileName: file.name,
                    mimeType: file.type || null,
                    bytes: new Uint8Array(await file.arrayBuffer()),
                }))
            ),
            createdBy: session.userId,
        });

        return NextResponse.json({
            ok: true,
            jobId: job.id,
            googleMapsEnabled: hasGoogleMapsKey(),
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Batch ingest failed";
        const status =
            message === "Missing spreadsheet file upload" ||
            message === "Unsupported spreadsheet file type" ||
            message === "Spreadsheet file is empty"
                ? 400
                : 500;
        return NextResponse.json({ error: message }, { status });
    }
}
