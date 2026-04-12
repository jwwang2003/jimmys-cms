import { NextResponse } from "next/server";

import { canEdit } from "@/lib/authz";
import { getCurrentSession } from "@/lib/session";
import { hasGoogleMapsKey } from "@/lib/google-maps";
import { readSpreadsheetImportFile } from "@/lib/media/spreadsheet-files";
import { batchIngestMediaIntoDb } from "@/lib/media/spreadsheet-import";
import { uploadMediaAsset } from "@/lib/media/service";

export const runtime = "nodejs";

function prefixForMimeType(mimeType?: string | null) {
    if (mimeType?.startsWith("image/")) return "content" as const;
    return "media" as const;
}

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
        const spreadsheetFileName = String(form.get("spreadsheetFileName") || "");
        if (!spreadsheetFileName.trim()) {
            return NextResponse.json({ error: "Missing spreadsheet file selection" }, { status: 400 });
        }

        const files = form
            .getAll("files")
            .filter((item): item is File => item instanceof File && item.size > 0);
        if (files.length === 0) {
            return NextResponse.json({ error: "Select at least one media file" }, { status: 400 });
        }

        const spreadsheet = await readSpreadsheetImportFile(spreadsheetFileName);
        const { sqlite } = await import("@/db");
        const summary = await batchIngestMediaIntoDb(sqlite, {
            spreadsheet,
            mediaFiles: await Promise.all(
                files.map(async (file) => ({
                    fileName: file.name,
                    mimeType: file.type || null,
                    bytes: new Uint8Array(await file.arrayBuffer()),
                }))
            ),
            persistFile: async (file) => {
                const asset = await uploadMediaAsset({
                    storageId: "default",
                    prefix: prefixForMimeType(file.mimeType),
                    fileName: file.fileName,
                    bytes: file.bytes,
                    mimeType: file.mimeType || null,
                    createdBy: session.userId,
                });

                if (!asset?.id || !asset.media_type || (asset.media_type !== "image" && asset.media_type !== "video")) {
                    throw new Error(`Failed to persist supported media asset for ${file.fileName}`);
                }

                return {
                    assetId: Number(asset.id),
                    mediaType: asset.media_type,
                };
            },
        });

        return NextResponse.json({
            ok: true,
            summary,
            googleMapsEnabled: hasGoogleMapsKey(),
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Batch ingest failed";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
