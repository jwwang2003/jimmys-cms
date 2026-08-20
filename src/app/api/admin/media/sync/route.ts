import { NextResponse } from "next/server";

import { canEdit } from "@/lib/authz";
import { getCurrentSession } from "@/lib/session";
import { syncS3Prefix } from "@/lib/media/service";

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
        const summary = await syncS3Prefix({
            storageId: String(body.storageId || "masters"),
            prefix: (String(body.prefix || "media") as "content" | "media" | "public" | "meta"),
            path: String(body.path || ""),
            maxKeys: Number(body.maxKeys || 200),
        });
        return NextResponse.json({ ok: true, summary });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Sync failed";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
