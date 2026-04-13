import { ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";

import { buildKey, getS3 } from "@/lib/s3";
import { verifyS3ObjectIntegrity } from "./integrity";
import { classifyStorageObject } from "./normalization";
import {
    getDashboardStats,
    getMediaAssetById,
    listMediaAssets,
    listAssetsForIntegrity,
    listStorageReviewItems,
    setAssetIntegrity,
    updateMediaAsset,
    upsertMediaAssetFromObject,
    upsertStorageObject,
} from "./repository";
import type { AssetUpdateInput } from "./types";

function objectUrlFromKey(storageId: string, key: string) {
    const { bucket, region } = getS3(storageId);
    if (!bucket) return null;
    if (region) {
        return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
    }
    return `https://${bucket}.s3.amazonaws.com/${key}`;
}

function folderTypeForMediaType(mediaType: "image" | "video" | "other") {
    if (mediaType === "image") return "images" as const;
    if (mediaType === "video") return "videos" as const;
    return "misc" as const;
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
    const key = buildKey(prefix, input.path || "", input.fileName);
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
            warnings: classification.warnings,
        });
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
    maxKeys?: number;
}) {
    const storageId = input.storageId || "default";
    const { client, bucket } = getS3(storageId);
    const prefixValue = buildKey(input.prefix || "media", input.path || "");

    const response = await client.send(
        new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefixValue,
            MaxKeys: input.maxKeys || 200,
        })
    );

    const summary = {
        discovered: 0,
        normalized: 0,
        warning: 0,
        invalid: 0,
    };

    for (const object of response.Contents || []) {
        if (!object.Key) continue;
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

        let assetId: number | null = null;
        if (classification.mediaType !== "other") {
            assetId = upsertMediaAssetFromObject({
                title: classification.title,
                mediaType: classification.mediaType,
                storageId,
                objectKey: object.Key,
                objectUrl: objectUrlFromKey(storageId, object.Key),
                mimeType,
                sizeBytes: Number(object.Size || 0),
                warnings: classification.warnings,
            });
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
    }

    return summary;
}

export function getMediaDashboard() {
    return {
        stats: getDashboardStats(),
        reviewItems: listStorageReviewItems(12),
    };
}

export function getMediaCatalog(filters?: {
    query?: string;
    mediaType?: string;
    status?: string;
    visibility?: string;
}) {
    return listMediaAssets(filters);
}

export function getMediaDetail(id: number) {
    return getMediaAssetById(id);
}

export function applyMediaUpdate(id: number, input: AssetUpdateInput) {
    return updateMediaAsset(id, input);
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
