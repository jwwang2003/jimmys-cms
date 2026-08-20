import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

import { getS3 } from "@/lib/s3";
import { deriveFromMaster, renditionKey, type DeriveResult } from "./derive";
import {
    replaceAssetRenditions,
    setAssetLqip,
    setAssetMeasuredDimensions,
    type RenditionInput,
} from "./repository";

export type DeriveTarget = {
    assetId: number;
    objectKey: string;
    /** Stable id used in the derived key, e.g. the asset slug or uid. */
    uid: string;
    /** Dimensions asserted elsewhere, for the plan's measured-vs-declared diff. */
    declaredWidth?: number | null;
    declaredHeight?: number | null;
};

export type DimensionDiff = {
    assetId: number;
    objectKey: string;
    declared: { width: number; height: number };
    measured: { width: number; height: number };
    /** True when the two differ only by a 90-degree rotation. */
    transposed: boolean;
};

export type DeriveOutcome = {
    assetId: number;
    objectKey: string;
    renditions: number;
    uploaded: number;
    measured: { width: number; height: number };
    skipped?: string;
    error?: string;
};

export type DeriveRunSummary = {
    processed: number;
    failed: number;
    renditionsWritten: number;
    objectsUploaded: number;
    dimensionsApplied: number;
    dimensionDiffs: DimensionDiff[];
    outcomes: DeriveOutcome[];
};

async function bodyToBuffer(body: unknown): Promise<Buffer> {
    const stream = body as AsyncIterable<Uint8Array>;
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
}

function derivedUrl(mediaStorageId: string, key: string) {
    const { cdnBaseUrl, endpoint, bucket } = getS3(mediaStorageId);
    const encoded = key.split("/").map(encodeURIComponent).join("/");
    if (cdnBaseUrl) return `${cdnBaseUrl.replace(/\/+$/, "")}/${encoded}`;
    if (endpoint) return `${endpoint.replace(/\/+$/, "")}/${bucket}/${encoded}`;
    return null;
}

/**
 * Derive renditions for a set of assets.
 *
 * Dimension writes are gated behind `applyDimensions`. The plan requires the
 * measured-vs-declared diff to be reviewed before overwriting, because a
 * disagreement can mean the master is not the file the catalog thinks it is —
 * and silently trusting the measurement would erase the evidence.
 */
export async function runDerive(input: {
    targets: DeriveTarget[];
    /** Alias holding the masters. Read-only here. */
    masterStorageId?: string;
    /** Alias the renditions are written to. */
    mediaStorageId?: string;
    /** Encode only; do not upload or write rows. */
    measureOnly?: boolean;
    /** Write measured dimensions even where they contradict the declared ones. */
    applyDimensions?: boolean;
    widths?: readonly number[];
    onProgress?: (done: number, total: number, target: DeriveTarget) => void;
}): Promise<DeriveRunSummary> {
    const masterStorageId = input.masterStorageId || "masters";
    const mediaStorageId = input.mediaStorageId || "media";

    const master = getS3(masterStorageId);
    const media = input.measureOnly ? null : getS3(mediaStorageId);

    const summary: DeriveRunSummary = {
        processed: 0,
        failed: 0,
        renditionsWritten: 0,
        objectsUploaded: 0,
        dimensionsApplied: 0,
        dimensionDiffs: [],
        outcomes: [],
    };

    let done = 0;
    for (const target of input.targets) {
        done += 1;
        input.onProgress?.(done, input.targets.length, target);

        try {
            const object = await master.client.send(
                new GetObjectCommand({ Bucket: master.bucket, Key: target.objectKey })
            );
            const bytes = await bodyToBuffer(object.Body);

            let result: DeriveResult;
            try {
                result = await deriveFromMaster(bytes, { widths: input.widths });
            } catch (error) {
                throw new Error(`derive failed: ${error instanceof Error ? error.message : String(error)}`);
            }

            // Compare before writing anything, so the diff reflects what was on
            // record at the time of measurement.
            let dimensionsConflict = false;
            if (target.declaredWidth && target.declaredHeight) {
                const sameOrientation =
                    target.declaredWidth === result.width && target.declaredHeight === result.height;
                if (!sameOrientation) {
                    dimensionsConflict = true;
                    summary.dimensionDiffs.push({
                        assetId: target.assetId,
                        objectKey: target.objectKey,
                        declared: { width: target.declaredWidth, height: target.declaredHeight },
                        measured: { width: result.width, height: result.height },
                        transposed:
                            target.declaredWidth === result.height && target.declaredHeight === result.width,
                    });
                }
            }

            let uploaded = 0;
            const rows: RenditionInput[] = [];

            for (const rendition of result.renditions) {
                const key = renditionKey(target.uid, rendition.width, rendition.format);
                if (media) {
                    await media.client.send(
                        new PutObjectCommand({
                            Bucket: media.bucket,
                            Key: key,
                            Body: rendition.bytes,
                            ContentType: rendition.mimeType,
                            // Every derived key carries its width and format, and
                            // content changes produce a new asset uid, so these
                            // objects are safe to treat as immutable.
                            CacheControl: "public, max-age=31536000, immutable",
                        })
                    );
                    uploaded += 1;
                }
                rows.push({
                    label: rendition.label,
                    objectKey: key,
                    objectUrl: media ? derivedUrl(mediaStorageId, key) : null,
                    mimeType: rendition.mimeType,
                    width: rendition.width,
                    height: rendition.height,
                    sizeBytes: rendition.bytes.length,
                });
            }

            if (!input.measureOnly) {
                replaceAssetRenditions(target.assetId, rows);
                setAssetLqip(target.assetId, result.lqip);
                summary.renditionsWritten += rows.length;

                if (!dimensionsConflict || input.applyDimensions) {
                    setAssetMeasuredDimensions(target.assetId, result.width, result.height);
                    summary.dimensionsApplied += 1;
                }
            }

            summary.objectsUploaded += uploaded;
            summary.processed += 1;
            summary.outcomes.push({
                assetId: target.assetId,
                objectKey: target.objectKey,
                renditions: rows.length,
                uploaded,
                measured: { width: result.width, height: result.height },
                ...(dimensionsConflict && !input.applyDimensions
                    ? { skipped: "dimension conflict — not applied pending review" }
                    : {}),
            });
        } catch (error) {
            summary.failed += 1;
            summary.outcomes.push({
                assetId: target.assetId,
                objectKey: target.objectKey,
                renditions: 0,
                uploaded: 0,
                measured: { width: 0, height: 0 },
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return summary;
}
