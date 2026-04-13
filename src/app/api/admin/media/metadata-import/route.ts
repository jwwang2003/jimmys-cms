import { NextResponse } from "next/server";

import { db } from "@/db";
import { canEdit } from "@/lib/authz";
import { getCurrentSession } from "@/lib/session";
import { hasGoogleMapsKey } from "@/lib/google-maps";
import { importMediaSpreadsheetIntoDb } from "@/lib/media/spreadsheet-import";
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

        const spreadsheet = await readSpreadsheetUpload(spreadsheetFile);
        const summary = await importMediaSpreadsheetIntoDb(db, spreadsheet);
        return NextResponse.json({
            ok: true,
            summary,
            googleMapsEnabled: hasGoogleMapsKey(),
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Spreadsheet import failed";
        const status =
            message === "Missing spreadsheet file upload" ||
            message === "Unsupported spreadsheet file type" ||
            message === "Spreadsheet file is empty"
                ? 400
                : 500;
        return NextResponse.json({ error: message }, { status });
    }
}
