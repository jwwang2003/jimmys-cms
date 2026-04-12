import { NextResponse } from "next/server";

import { canEdit } from "@/lib/authz";
import { getCurrentSession } from "@/lib/session";
import { normalizeAssetUpdatePayload } from "@/lib/media/forms";
import { applyMediaUpdate, getMediaDetail } from "@/lib/media/service";

export const runtime = "nodejs";

function getAssetId(raw: string) {
    const id = Number(raw);
    if (!Number.isFinite(id)) {
        throw new Error("Invalid asset id");
    }
    return id;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
    const session = await getCurrentSession();
    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const asset = getMediaDetail(getAssetId(id));
    if (!asset) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ asset, role: session.role });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
    const session = await getCurrentSession();
    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canEdit(session.role)) {
        return NextResponse.json({ error: "Guests have read-only access" }, { status: 403 });
    }

    const { id } = await context.params;
    const body = await request.json();
    const asset = applyMediaUpdate(getAssetId(id), normalizeAssetUpdatePayload(body));
    return NextResponse.json({ ok: true, asset });
}
