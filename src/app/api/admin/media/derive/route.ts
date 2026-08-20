import { NextResponse } from "next/server";

import { db } from "@/db";
import { canEdit } from "@/lib/authz";
import { getCurrentSession } from "@/lib/session";
import { mediaAssets } from "@/db/schema/schema";
import { and, eq, like } from "drizzle-orm";
import { createAndRunDeriveJob } from "@/lib/media/ingest-jobs";

export const runtime = "nodejs";

/**
 * Queue a derive job. Returns immediately with the job id; progress is read
 * from the existing SSE stream at
 * `/api/admin/media/batch-import/<jobId>/events`, which is mode-agnostic.
 */
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
        const filter = body.filter ? String(body.filter) : null;
        const limit = body.limit ? Number(body.limit) : null;

        const rows = db
            .select({
                id: mediaAssets.id,
                slug: mediaAssets.slug,
                objectKey: mediaAssets.objectKey,
                width: mediaAssets.width,
                height: mediaAssets.height,
            })
            .from(mediaAssets)
            .where(
                filter
                    ? and(
                          eq(mediaAssets.mediaType, "image"),
                          eq(mediaAssets.lifecycleStatus, "active"),
                          like(mediaAssets.objectKey, `%${filter}%`)
                      )
                    : and(eq(mediaAssets.mediaType, "image"), eq(mediaAssets.lifecycleStatus, "active"))
            )
            .all();

        const selected = limit && limit > 0 ? rows.slice(0, limit) : rows;
        if (selected.length === 0) {
            return NextResponse.json({ error: "No matching assets to derive" }, { status: 400 });
        }

        const job = await createAndRunDeriveJob({
            targets: selected.map((row) => ({
                assetId: row.id,
                objectKey: row.objectKey,
                uid: row.slug,
                declaredWidth: row.width,
                declaredHeight: row.height,
            })),
            applyDimensions: body.applyDimensions === true,
            measureOnly: body.measureOnly === true,
            createdBy: session.userId,
        });

        return NextResponse.json({
            ok: true,
            jobId: job.id,
            assets: selected.length,
            eventsUrl: `/api/admin/media/batch-import/${job.id}/events`,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Could not start derive job";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
