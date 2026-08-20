import { NextResponse } from "next/server";

import { canEdit } from "@/lib/authz";
import { getCurrentSession } from "@/lib/session";
import { getMediaCatalog, uploadMediaAsset } from "@/lib/media/service";

export const runtime = "nodejs";

function unauthorized() {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(request: Request) {
    const session = await getCurrentSession();
    if (!session) return unauthorized();

    const { searchParams } = new URL(request.url);
    const assets = getMediaCatalog({
        query: searchParams.get("query") || "",
        mediaType: searchParams.get("mediaType") || "all",
        status: searchParams.get("status") || "all",
        // Guests browse read-only, but read-only is not "read everything":
        // anyone can mint a guest session from /login, so non-editors are
        // pinned to public assets no matter what the query string asks for.
        visibility: canEdit(session.role) ? searchParams.get("visibility") || "all" : "public",
    });

    return NextResponse.json({ assets, role: session.role });
}

export async function POST(request: Request) {
    const session = await getCurrentSession();
    if (!session) return unauthorized();
    if (!canEdit(session.role)) {
        return NextResponse.json({ error: "Guests have read-only access" }, { status: 403 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
        return NextResponse.json({ error: "Missing file upload" }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const asset = await uploadMediaAsset({
        storageId: String(form.get("storageId") || "default"),
        prefix: (String(form.get("prefix") || "media") as "content" | "media" | "public" | "meta"),
        path: String(form.get("path") || ""),
        fileName: file.name,
        bytes,
        mimeType: file.type || null,
        createdBy: session.userId,
    });

    return NextResponse.json({ ok: true, asset });
}
