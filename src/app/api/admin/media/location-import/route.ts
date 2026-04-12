import { NextResponse } from "next/server";

import { canEdit } from "@/lib/authz";
import { getCurrentSession } from "@/lib/session";
import { hasGoogleMapsKey } from "@/lib/google-maps";
import { importLocationsFromCsv } from "@/lib/media/location-import";

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
        const csv = String(body.csv || "");
        if (!csv.trim()) {
            return NextResponse.json({ error: "Missing CSV payload" }, { status: 400 });
        }

        const summary = await importLocationsFromCsv(csv);
        return NextResponse.json({
            ok: true,
            summary,
            googleMapsEnabled: hasGoogleMapsKey(),
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Location import failed";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
