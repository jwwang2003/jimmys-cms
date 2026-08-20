import { NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { getCurrentSession } from "@/lib/session";
import { getS3 } from "@/lib/s3";
import { getMediaAssetById } from "@/lib/media/repository";

export const runtime = "nodejs";

/** Long enough to open and download a 30 MB original, short enough to matter. */
const EXPIRES_IN_SECONDS = 5 * 60;

/**
 * Redirect to a short-lived signed URL for an asset's master file.
 *
 * The masters bucket is private and has no custom domain, so linking a browser
 * straight at the object gets an R2 `InvalidArgument / Authorization` error —
 * the browser has no credentials and never will. Presigning moves the
 * authorization decision into the app, where the session already is, and still
 * keeps the bytes off the app's own request path.
 *
 * Deliberately not a permanent public URL: the whole point of the masters
 * bucket being private is that a link to it should not outlive the session that
 * asked for it.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
    const session = await getCurrentSession();
    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    try {
        const { id } = await context.params;
        const assetId = Number(id);
        if (!Number.isFinite(assetId)) {
            return NextResponse.json({ error: "Invalid asset id" }, { status: 400 });
        }

        const asset = getMediaAssetById(assetId);
        if (!asset) {
            return NextResponse.json({ error: "Asset not found" }, { status: 404 });
        }

        const { client, bucket } = getS3(asset.storage_id);
        const url = await getSignedUrl(
            client,
            new GetObjectCommand({ Bucket: bucket, Key: asset.object_key }),
            { expiresIn: EXPIRES_IN_SECONDS }
        );

        return NextResponse.redirect(url, {
            status: 307,
            // The redirect target carries a signature, so it must not be cached
            // or shared.
            headers: { "Cache-Control": "no-store, private" },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Could not sign the original file URL";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
