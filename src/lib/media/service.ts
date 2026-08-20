import type { Readable } from "node:stream";
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { extname } from "node:path";

import { geocodeAddress, hasGoogleMapsKey } from "@/lib/google-maps";
import { buildKey, getS3 } from "@/lib/s3";
import { extractPhotoExif } from "./exif";
import { verifyS3ObjectIntegrity } from "./integrity";
import { classifyStorageObject } from "./normalization";
import {
    applyGeocodeToLocation,
    archiveMediaAsset,
    getRefreshableLocationForAsset,
    getDashboardStats,
    getMediaAssetById,
    listRefreshableLocations,
    listPendingLocationConflicts,
    listMediaAssets,
    listAssetsForIntegrity,
    markLocationGeocodeFailed,
    reconcileStoredExifLocation,
    listStorageReviewItems,
    permanentlyDeleteMediaAsset,
    restoreMediaAsset,
    resolveAssetLocationConflict,
    upsertPhotoExif,
    setAssetIntegrity,
    trashMediaAsset,
    updateMediaAsset,
    upsertMediaAssetFromObject,
    upsertStorageObject,
} from "./repository";
import type { AssetUpdateInput, LocationConflictResolution } from "./types";

type BodyToBufferInput =
    | ReadableStream<Uint8Array>
    | AsyncIterable<Uint8Array | Buffer | string>
    | Readable
    | Uint8Array
    | ArrayBuffer
    | string
    | null
    | undefined;

function objectUrlFromKey(storageId: string, key: string) {
    const { bucket, region, endpoint, cdnBaseUrl } = getS3(storageId);
    if (!bucket) return null;
    const encoded = key.split("/").map(encodeURIComponent).join("/");
    // A CDN base URL is the address the object is actually served from, so it
    // wins over anything derived from the bucket.
    if (cdnBaseUrl) {
        return `${cdnBaseUrl.replace(/\/+$/, "")}/${encoded}`;
    }
    // Non-AWS S3 (R2): the account endpoint addresses buckets path-style.
    // Building an amazonaws.com URL here would be a link to nowhere.
    if (endpoint) {
        return `${endpoint.replace(/\/+$/, "")}/${bucket}/${encoded}`;
    }
    if (region) {
        return `https://${bucket}.s3.${region}.amazonaws.com/${encoded}`;
    }
    return `https://${bucket}.s3.amazonaws.com/${encoded}`;
}

function folderTypeForMediaType(mediaType: "image" | "video" | "other") {
    if (mediaType === "image") return "images" as const;
    if (mediaType === "video") return "videos" as const;
    return "misc" as const;
}

function normalizeExtension(fileName: string) {
    const ext = extname(fileName).toLowerCase();
    return ext || ".bin";
}

export function determineManagedMediaType(fileName: string, mimeType?: string | null) {
    if (mimeType) {
        if (mimeType.startsWith("image/")) return "image" as const;
        if (mimeType.startsWith("video/")) return "video" as const;
    }
    const extension = normalizeExtension(fileName);
    if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"].includes(extension)) {
        return "image" as const;
    }
    if ([".mp4", ".mov", ".webm", ".m4v"].includes(extension)) {
        return "video" as const;
    }
    return "other" as const;
}

const MANAGED_PREFIXES = ["content", "media", "public", "meta"] as const;

/**
 * A user-supplied folder path only steers the key *inside* the managed
 * prefix; a `..` segment must not climb out of it, and R2 would happily store
 * the literal `media/../x` key. Unsafe segments are dropped rather than
 * rejected so an upload still lands under a safe key.
 */
function sanitizeKeyPath(path?: string) {
    return (path || "")
        .split("/")
        .map((segment) => segment.trim())
        .filter((segment) => segment !== "" && segment !== "." && segment !== ".." && !segment.includes("\\"))
        .join("/");
}

export function buildManagedObjectKey(
    mediaType: "image" | "video" | "other",
    fileName: string,
    prefix: "content" | "media" | "public" | "meta",
    path?: string
) {
    const suffix = `${randomUUID()}${normalizeExtension(fileName)}`;
    if (mediaType === "image") {
        return buildKey("content", "images", suffix);
    }
    if (mediaType === "video") {
        return buildKey("media", "videos", suffix);
    }
    // Routes cast the prefix straight off the request body, so an unknown
    // value must degrade to the default instead of silently keying to the
    // bucket root (buildKey drops prefixes it does not recognise).
    const safePrefix = (MANAGED_PREFIXES as readonly string[]).includes(prefix) ? prefix : "media";
    return buildKey(safePrefix, sanitizeKeyPath(path), suffix);
}

async function bodyToBuffer(body: BodyToBufferInput): Promise<Buffer> {
    if (!body) return Buffer.alloc(0);
    if (typeof (body as ReadableStream<Uint8Array>).getReader === "function") {
        const reader = (body as ReadableStream<Uint8Array>).getReader();
        const parts: Uint8Array[] = [];
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) parts.push(value);
        }
        return Buffer.concat(parts.map((part) => Buffer.from(part)));
    }
    if (typeof (body as AsyncIterable<Uint8Array | Buffer | string>)[Symbol.asyncIterator] === "function") {
        const parts: Buffer[] = [];
        for await (const chunk of body as AsyncIterable<Uint8Array | Buffer | string>) {
            parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        return Buffer.concat(parts);
    }
    if (typeof (body as Readable).on === "function") {
        return await new Promise<Buffer>((resolve, reject) => {
            const parts: Buffer[] = [];
            (body as Readable).on("data", (chunk: Buffer | string | Uint8Array) =>
                parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
            );
            (body as Readable).on("end", () => resolve(Buffer.concat(parts)));
            (body as Readable).on("error", reject);
        });
    }
    if (body instanceof Uint8Array) return Buffer.from(body);
    if (body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(body));
    return Buffer.from(String(body));
}

export async function uploadMediaAsset(input: {
    storageId?: string;
    prefix?: "content" | "media" | "public" | "meta";
    path?: string;
    fileName: string;
    bytes: Uint8Array;
    mimeType?: string | null;
    createdBy?: string | null;
}) {
    const storageId = input.storageId || "default";
    const prefix = input.prefix || "media";
    const mediaTypeHint = determineManagedMediaType(input.fileName, input.mimeType);
    const key = buildManagedObjectKey(mediaTypeHint, input.fileName, prefix, input.path);
    const { client, bucket } = getS3(storageId);
    await client.send(
        new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: input.bytes,
            ContentType: input.mimeType || undefined,
        })
    );

    const classification = classifyStorageObject({
        key,
        mimeType: input.mimeType,
        sizeBytes: input.bytes.byteLength,
    });
    let exifWarning = false;
    let photoExif = null;
    if (classification.mediaType === "image") {
        try {
            photoExif = extractPhotoExif(input.bytes);
        } catch {
            exifWarning = true;
            classification.warnings.push("exif parse failed");
        }
    }

    const objectUrl = objectUrlFromKey(storageId, key);
    let assetId: number | null = null;
    if (classification.mediaType !== "other") {
        assetId = upsertMediaAssetFromObject({
            title: classification.title,
            mediaType: classification.mediaType,
            storageId,
            objectKey: key,
            objectUrl,
            mimeType: input.mimeType,
            sizeBytes: input.bytes.byteLength,
            createdBy: input.createdBy,
            width: photoExif?.pixelWidth ?? null,
            height: photoExif?.pixelHeight ?? null,
            warnings: classification.warnings,
            filename: input.fileName,
        });
    }

    if (assetId && photoExif) {
        upsertPhotoExif(assetId, photoExif);
        reconcileStoredExifLocation(assetId);
    } else if (assetId && exifWarning) {
        reconcileStoredExifLocation(assetId);
    }

    upsertStorageObject({
        storageId,
        folderType: folderTypeForMediaType(classification.mediaType),
        objectKey: key,
        objectUrl,
        mimeType: input.mimeType,
        sizeBytes: input.bytes.byteLength,
        syncStatus:
            classification.outcome === "valid"
                ? "normalized"
                : classification.outcome === "warning"
                    ? "warning"
                    : "invalid",
        warnings: classification.warnings,
        assetId,
    });

    return assetId ? getMediaAssetById(assetId) : null;
}

export async function syncS3Prefix(input: {
    storageId?: string;
    prefix?: "content" | "media" | "public" | "meta";
    path?: string;
    /**
     * Literal key prefix, bypassing the four configured `prefixes`. Buckets the
     * CMS did not lay out itself — the R2 masters bucket, for one — do not use
     * those names.
     */
    rawPrefix?: string;
    /** Stop after this many objects. Undefined means the whole prefix. */
    limit?: number;
    /** Page size for each ListObjectsV2 call. */
    maxKeys?: number;
    /** Skip the byte-for-byte EXIF read. Listing alone is cheap; this is not. */
    skipExif?: boolean;
    /**
     * Create a `media_assets` row per object. Set false to record what the
     * bucket holds without cataloguing it — the retained-but-uncatalogued
     * `masters/orphaned` tree is exactly this case.
     */
    createAssets?: boolean;
    onProgress?: (done: number, key: string) => void;
}) {
    const storageId = input.storageId || "default";
    const { client, bucket } = getS3(storageId);
    const prefixValue = input.rawPrefix ?? buildKey(input.prefix || "media", input.path || "");

    const summary = {
        discovered: 0,
        normalized: 0,
        warning: 0,
        invalid: 0,
    };

    // ListObjectsV2 returns at most 1000 keys per call. The previous single-shot
    // request silently stopped at the first page, so a bucket larger than the
    // page size synced partially and reported success.
    const objects: Array<{ Key?: string; Size?: number; ETag?: string; LastModified?: Date }> = [];
    let continuationToken: string | undefined;
    do {
        const response = await client.send(
            new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: prefixValue,
                MaxKeys: input.maxKeys || 1000,
                ContinuationToken: continuationToken,
            })
        );
        objects.push(...(response.Contents || []));
        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
        if (input.limit && objects.length >= input.limit) break;
    } while (continuationToken);

    const selected = input.limit ? objects.slice(0, input.limit) : objects;

    for (const object of selected) {
        if (!object.Key) continue;
        // A "directory" placeholder, not a file.
        if (object.Key.endsWith("/")) continue;
        summary.discovered += 1;
        const mimeType = object.Key.endsWith(".mp4")
            ? "video/mp4"
            : object.Key.match(/\.(jpg|jpeg|png|gif|webp|avif)$/i)
                ? "image/jpeg"
                : null;
        const classification = classifyStorageObject({
            key: object.Key,
            mimeType,
            sizeBytes: Number(object.Size || 0),
        });
        let photoExif = null;
        if (classification.mediaType === "image" && !input.skipExif) {
            try {
                const objectResponse = await client.send(new GetObjectCommand({ Bucket: bucket, Key: object.Key }));
                const bytes = await bodyToBuffer(objectResponse.Body as BodyToBufferInput);
                photoExif = extractPhotoExif(bytes);
            } catch {
                classification.warnings.push("exif parse failed");
            }
        }

        let assetId: number | null = null;
        if (classification.mediaType !== "other" && input.createAssets !== false) {
            assetId = upsertMediaAssetFromObject({
                title: classification.title,
                mediaType: classification.mediaType,
                storageId,
                objectKey: object.Key,
                objectUrl: objectUrlFromKey(storageId, object.Key),
                mimeType,
                sizeBytes: Number(object.Size || 0),
                width: photoExif?.pixelWidth ?? null,
                height: photoExif?.pixelHeight ?? null,
                warnings: classification.warnings,
            });
        }

        if (assetId && photoExif) {
            upsertPhotoExif(assetId, photoExif);
            reconcileStoredExifLocation(assetId);
        }

        const syncStatus =
            classification.outcome === "valid"
                ? "normalized"
                : classification.outcome === "warning"
                    ? "warning"
                    : "invalid";

        summary[syncStatus] += 1;

        upsertStorageObject({
            storageId,
            folderType: folderTypeForMediaType(classification.mediaType),
            objectKey: object.Key,
            objectUrl: objectUrlFromKey(storageId, object.Key),
            mimeType,
            sizeBytes: Number(object.Size || 0),
            eTag: object.ETag || null,
            lastModified: object.LastModified ? new Date(object.LastModified).getTime() : null,
            syncStatus,
            warnings: classification.warnings,
            assetId,
        });

        input.onProgress?.(summary.discovered, object.Key);
    }

    return summary;
}

export function getMediaDashboard() {
    return {
        stats: getDashboardStats(),
        reviewItems: listStorageReviewItems(12),
    };
}

export function getPendingExifLocationConflicts(limit = 20) {
    return listPendingLocationConflicts(limit);
}

export function applyLocationConflictResolution(
    conflictId: number,
    resolution: LocationConflictResolution,
    resolvedBy?: string | null
) {
    return resolveAssetLocationConflict(conflictId, resolution, resolvedBy);
}

export function getMediaCatalog(filters?: {
    query?: string;
    mediaType?: string;
    status?: string;
    visibility?: string;
    lifecycleStatus?: "active" | "trashed" | "all";
    integrityStatus?: "ok" | "missing" | "warning" | "invalid" | "all";
}) {
    return listMediaAssets(filters);
}

export function getMediaDetail(id: number) {
    return getMediaAssetById(id);
}

export function applyMediaUpdate(id: number, input: AssetUpdateInput) {
    return updateMediaAsset(id, input);
}

function resolveLocationAddress(location: {
    rawAddress?: string | null;
    formattedAddress?: string | null;
    label?: string | null;
}) {
    return location.rawAddress || location.formattedAddress || location.label || "";
}

export async function refreshMediaAssetGeolocation(assetId: number) {
    const asset = getMediaDetail(assetId);
    if (!asset) {
        throw new Error("Asset not found");
    }

    const candidate = getRefreshableLocationForAsset(assetId);
    if (!candidate) {
        return {
            asset,
            summary: {
                checked: 0,
                updated: 0,
                geocoded: 0,
                failed: 0,
                skipped: 1,
                googleMapsEnabled: hasGoogleMapsKey(),
                message: "No refreshable non-EXIF location found.",
            },
        };
    }

    const address = resolveLocationAddress(candidate);
    if (!hasGoogleMapsKey()) {
        return {
            asset,
            summary: {
                checked: 1,
                updated: 0,
                geocoded: 0,
                failed: 0,
                skipped: 1,
                googleMapsEnabled: false,
                message: "Google Maps API key is missing.",
            },
        };
    }

    if (!address.trim()) {
        return {
            asset,
            summary: {
                checked: 1,
                updated: 0,
                geocoded: 0,
                failed: 0,
                skipped: 1,
                googleMapsEnabled: true,
                message: "Location row has no usable address.",
            },
        };
    }

    try {
        const geocoded = await geocodeAddress(address);
        if (!geocoded) {
            markLocationGeocodeFailed(candidate.id);
            return {
                asset: getMediaDetail(assetId),
                summary: {
                    checked: 1,
                    updated: 0,
                    geocoded: 0,
                    failed: 1,
                    skipped: 0,
                    googleMapsEnabled: true,
                    message: "Google Maps could not geocode the address.",
                },
            };
        }

        applyGeocodeToLocation(candidate.id, {
            formattedAddress: geocoded.formattedAddress,
            googlePlaceId: geocoded.placeId,
            lat: geocoded.lat,
            lng: geocoded.lng,
            rawResponseJson: geocoded.rawResponseJson,
        });
        if (candidate.mediaType === "image") {
            reconcileStoredExifLocation(assetId);
        }

        return {
            asset: getMediaDetail(assetId),
            summary: {
                checked: 1,
                updated: 1,
                geocoded: 1,
                failed: 0,
                skipped: 0,
                googleMapsEnabled: true,
                message: "Location refreshed from Google Maps.",
            },
        };
    } catch (error) {
        markLocationGeocodeFailed(candidate.id);
        return {
            asset: getMediaDetail(assetId),
            summary: {
                checked: 1,
                updated: 0,
                geocoded: 0,
                failed: 1,
                skipped: 0,
                googleMapsEnabled: true,
                message: error instanceof Error ? error.message : "Google Maps refresh failed.",
            },
        };
    }
}

export async function refreshManyMediaAssetGeolocations(options?: { mode?: "pending" | "force"; limit?: number }) {
    const candidates = listRefreshableLocations(options);
    const googleMapsEnabled = hasGoogleMapsKey();
    const summary = {
        checked: candidates.length,
        updated: 0,
        geocoded: 0,
        failed: 0,
        skipped: 0,
        googleMapsEnabled,
        message: "",
    };

    if (!googleMapsEnabled) {
        summary.skipped = candidates.length;
        summary.message = "Google Maps API key is missing.";
        return summary;
    }

    for (const candidate of candidates) {
        const address = resolveLocationAddress(candidate);
        if (!address.trim()) {
            summary.skipped += 1;
            continue;
        }

        try {
            const geocoded = await geocodeAddress(address);
            if (!geocoded) {
                markLocationGeocodeFailed(candidate.id);
                summary.failed += 1;
                continue;
            }

            applyGeocodeToLocation(candidate.id, {
                formattedAddress: geocoded.formattedAddress,
                googlePlaceId: geocoded.placeId,
                lat: geocoded.lat,
                lng: geocoded.lng,
                rawResponseJson: geocoded.rawResponseJson,
            });
            if (candidate.mediaType === "image") {
                reconcileStoredExifLocation(candidate.assetId);
            }
            summary.updated += 1;
            summary.geocoded += 1;
        } catch {
            markLocationGeocodeFailed(candidate.id);
            summary.failed += 1;
        }
    }

    summary.message = `Checked ${summary.checked}. Updated ${summary.updated}. Failed ${summary.failed}. Skipped ${summary.skipped}.`;
    return summary;
}

export async function verifyMediaAssetIntegrity(assetId: number) {
    const asset = getMediaDetail(assetId);
    if (!asset) {
        throw new Error("Asset not found");
    }

    const result = await verifyS3ObjectIntegrity({
        storageId: asset.storage_id,
        objectKey: asset.object_key,
    });
    setAssetIntegrity(assetId, result);
    return getMediaDetail(assetId);
}

export async function verifyManyMediaAssets() {
    const assets = listAssetsForIntegrity({ lifecycleStatus: "active" });
    const summary = {
        checked: 0,
        ok: 0,
        missing: 0,
        warning: 0,
        invalid: 0,
    };

    for (const asset of assets) {
        const result = await verifyS3ObjectIntegrity({
            storageId: asset.storage_id,
            objectKey: asset.object_key,
        });
        setAssetIntegrity(asset.id, result);
        summary.checked += 1;
        summary[result.integrityStatus] += 1;
    }

    return summary;
}

export async function applyMediaLifecycleAction(
    action: "archive" | "trash" | "restore" | "permadelete" | "verify",
    input: { assetId: number }
) {
    if (action === "archive") {
        archiveMediaAsset(input.assetId);
        return getMediaDetail(input.assetId);
    }

    if (action === "trash") {
        trashMediaAsset(input.assetId);
        return getMediaDetail(input.assetId);
    }

    if (action === "restore") {
        restoreMediaAsset(input.assetId);
        return getMediaDetail(input.assetId);
    }

    if (action === "permadelete") {
        permanentlyDeleteMediaAsset(input.assetId);
        return { ok: true };
    }

    return verifyMediaAssetIntegrity(input.assetId);
}
