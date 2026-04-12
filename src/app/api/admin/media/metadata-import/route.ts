import { NextResponse } from "next/server";

import { canEdit } from "@/lib/authz";
import { getCurrentSession } from "@/lib/session";
import { hasGoogleMapsKey } from "@/lib/google-maps";
import { importMediaSpreadsheet } from "@/lib/media/spreadsheet-import";
import { readSpreadsheetImportFile } from "@/lib/media/spreadsheet-files";

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
        const body = await request.json().catch(() => ({}));
        const fileName = String(body.fileName || "");
        if (!fileName.trim()) {
            return NextResponse.json({ error: "Missing import file name" }, { status: 400 });
        }

        const file = await readSpreadsheetImportFile(fileName);
        const summary = await importMediaSpreadsheet(file);
        return NextResponse.json({
            ok: true,
            summary,
            googleMapsEnabled: hasGoogleMapsKey(),
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Spreadsheet import failed";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
