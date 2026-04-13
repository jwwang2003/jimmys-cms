import { NextResponse } from "next/server";

import { canEdit } from "@/lib/authz";
import {
    applyLocationConflictResolution,
    applyMediaLifecycleAction,
    refreshManyMediaAssetGeolocations,
    verifyManyMediaAssets,
} from "@/lib/media/service";
import { getCurrentSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
    const session = await getCurrentSession();
    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canEdit(session.role)) {
        return NextResponse.json({ error: "Guests have read-only access" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "verifyMany") {
        const summary = await verifyManyMediaAssets();
        return NextResponse.json({ ok: true, summary });
    }

    if (action === "resolveLocationConflict") {
        const conflictId = Number(body.conflictId);
        const resolution = String(body.resolution || "");
        if (!Number.isFinite(conflictId)) {
            return NextResponse.json({ error: "Missing conflict id" }, { status: 400 });
        }
        if (resolution !== "keep_exif" && resolution !== "keep_existing") {
            return NextResponse.json({ error: "Missing conflict resolution" }, { status: 400 });
        }

        const result = applyLocationConflictResolution(conflictId, resolution, session.userId);
        return NextResponse.json({ ok: true, result });
    }

    if (action === "refreshManyGeocodes") {
        const mode = body.mode === "force" ? "force" : "pending";
        const summary = await refreshManyMediaAssetGeolocations({ mode });
        return NextResponse.json({ ok: true, summary });
    }

    const assetId = Number(body.assetId);
    if (!Number.isFinite(assetId)) {
        return NextResponse.json({ error: "Missing asset id" }, { status: 400 });
    }

    const result = await applyMediaLifecycleAction(
        action as "archive" | "trash" | "restore" | "permadelete" | "verify",
        { assetId }
    );

    return NextResponse.json({ ok: true, result });
}
