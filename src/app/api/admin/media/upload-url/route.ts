import { NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { canEdit } from "@/lib/authz";
import { getCurrentSession } from "@/lib/session";
import { getS3 } from "@/lib/s3";
import { buildManagedObjectKey, determineManagedMediaType } from "@/lib/media/service";

export const runtime = "nodejs";

/** Presigned URLs are short-lived on purpose: it is a write grant on a bucket. */
const EXPIRES_IN_SECONDS = 15 * 60;

/** Refuse to sign for something that is not an upload we would accept anyway. */
const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

/**
 * Hand the browser a presigned PUT so master originals go straight to R2.
 *
 * The existing multipart route (`../route.ts`) reads the whole file into memory
 * via `formData()` then `arrayBuffer()` before it can forward a single byte.
 * That is survivable for a spreadsheet and not for a 33 MB camera original, and
 * it scales with request size rather than count. Presigning removes the app
 * from the data path entirely; it only issues the grant.
 *
 * The proxy route stays for spreadsheets, which are small and need parsing
 * server-side anyway.
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
        const body = await request.json();
        const fileName = String(body.fileName || "").trim();
        if (!fileName) {
            return NextResponse.json({ error: "Missing fileName" }, { status: 400 });
        }

        const sizeBytes = Number(body.sizeBytes || 0);
        if (sizeBytes > MAX_UPLOAD_BYTES) {
            return NextResponse.json(
                { error: `File exceeds the ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit` },
                { status: 413 }
            );
        }

        const storageId = String(body.storageId || "masters");
        const mimeType = body.mimeType ? String(body.mimeType) : null;

        // The key is derived server-side. Letting the client name the key would
        // let it write anywhere in the bucket the signature covers.
        const key = body.objectKey
            ? null
            : buildManagedObjectKey(
                  determineManagedMediaType(fileName, mimeType),
                  fileName,
                  String(body.prefix || "media") as "content" | "media" | "public" | "meta",
                  String(body.path || "")
              );
        if (!key) {
            return NextResponse.json({ error: "objectKey may not be supplied by the client" }, { status: 400 });
        }

        const { client, bucket } = getS3(storageId);
        const url = await getSignedUrl(
            client,
            new PutObjectCommand({
                Bucket: bucket,
                Key: key,
                ContentType: mimeType || undefined,
            }),
            { expiresIn: EXPIRES_IN_SECONDS }
        );

        return NextResponse.json({
            ok: true,
            url,
            method: "PUT",
            objectKey: key,
            storageId,
            expiresIn: EXPIRES_IN_SECONDS,
            // The client must send this back on the PUT, or the signature that
            // covered ContentType will not match.
            headers: mimeType ? { "Content-Type": mimeType } : {},
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Could not create upload URL";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
