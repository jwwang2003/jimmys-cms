import { NextResponse } from "next/server";

import { canEdit } from "@/lib/authz";
import { applyMediaLifecycleAction, verifyManyMediaAssets } from "@/lib/media/service";
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
