import { NextResponse } from "next/server";

import { canEdit } from "@/lib/authz";
import { getCurrentSession } from "@/lib/session";
import { normalizeAssetUpdatePayload } from "@/lib/media/forms";
import { applyMediaUpdate, getMediaDetail, refreshMediaAssetGeolocation } from "@/lib/media/service";

export const runtime = "nodejs";

function getAssetId(raw: string) {
    const id = Number(raw);
    return Number.isFinite(id) ? id : null;
}

function invalidAssetId() {
    return NextResponse.json({ error: "Invalid asset id" }, { status: 400 });
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
    const session = await getCurrentSession();
    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const assetId = getAssetId(id);
    if (assetId === null) return invalidAssetId();
    const asset = getMediaDetail(assetId);
    // Non-public assets 404 for non-editors rather than 403: a guest session
    // is mintable by anyone, and confirming a private asset id exists is
    // itself a leak.
    if (!asset || (!canEdit(session.role) && asset.visibility !== "public")) {
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
    const assetId = getAssetId(id);
    if (assetId === null) return invalidAssetId();
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const asset = applyMediaUpdate(assetId, normalizeAssetUpdatePayload(body));
    return NextResponse.json({ ok: true, asset });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
    const session = await getCurrentSession();
    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canEdit(session.role)) {
        return NextResponse.json({ error: "Guests have read-only access" }, { status: 403 });
    }

    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action !== "refreshGeocode") {
        return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
    }

    const assetId = getAssetId(id);
    if (assetId === null) return invalidAssetId();
    const result = await refreshMediaAssetGeolocation(assetId);
    return NextResponse.json({ ok: true, ...result });
}
