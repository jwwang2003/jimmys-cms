import { db } from "@/db";
import {
    and,
    asc,
    count,
    desc,
    eq,
    inArray,
    like,
    ne,
    or,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
    assetLocationConflicts,
    assetLocations,
    collectionAssets,
    collections,
    mediaAssets,
    mediaTags,
    photoCameras,
    photoExif,
    photoLenses,
    mediaRenditions,
    storageObjects,
    tags,
} from "@/db/schema/schema";
import { user as authUser } from "../../../auth-schema";
import type {
    AssetIntegrityStatus,
    AssetLifecycleStatus,
    AssetLocationInput,
    AssetUpdateInput,
    LocationConflictRecord,
    LocationConflictResolution,
    ManagedMediaType,
    PhotoExifInput,
} from "./types";
import { slugFromText } from "./normalization";

type RawAssetRecord = {
    id: number;
    title: string;
    slug: string;
    description: string | null;
    media_type: ManagedMediaType;
    storage_id: string;
    object_key: string;
    filename: string | null;
    object_url: string | null;
    thumbnail_url: string | null;
    mime_type: string | null;
    size_bytes: number;
    status: "draft" | "review" | "published" | "archived";
    visibility: "private" | "internal" | "public";
    lifecycle_status: AssetLifecycleStatus;
    integrity_status: AssetIntegrityStatus;
    integrity_message: string | null;
    last_verified_at: number | null;
    trashed_at: number | null;
    warnings_json: string | null;
    metadata_json: string | null;
    created_at: number;
    updated_at: number;
};

export type StorageReviewItem = {
    id: number;
    object_key: string;
    sync_status: string;
    last_error: string | null;
    warnings: string[];
};

export type AssetMatch = {
    id: number;
    title: string;
    media_type: "image" | "video" | "audio" | "document" | "other";
};

export type IntegrityAssetRecord = {
    id: number;
    storage_id: string;
    object_key: string;
    filename: string | null;
};

export type LocationRefreshCandidate = {
    id: number;
    assetId: number;
    mediaType: AssetMatch["media_type"];
    source: string | null;
    status: string | null;
    label: string | null;
    rawAddress: string | null;
    formattedAddress: string | null;
};

type SelectedAssetRow = Omit<RawAssetRecord, "last_verified_at" | "trashed_at" | "created_at" | "updated_at"> & {
    last_verified_at: Date | number | null;
    trashed_at: Date | number | null;
    created_at: Date | number | null;
    updated_at: Date | number | null;
};

function parseJsonArray(value: string | null | undefined) {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function now() {
    return new Date();
}

function toMillis(value: unknown) {
    if (value instanceof Date) return value.getTime();
    if (typeof value === "number") return value;
    if (value == null) return null;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
}

function normalizeAssetRow(row: SelectedAssetRow): RawAssetRecord {
    return {
        ...row,
        last_verified_at: toMillis(row.last_verified_at),
        trashed_at: toMillis(row.trashed_at),
        created_at: toMillis(row.created_at) || 0,
        updated_at: toMillis(row.updated_at) || 0,
    };
}

function toDate(value: number | null | undefined) {
    return value == null ? null : new Date(value);
}

function normalizeExifKey(...parts: Array<string | null | undefined>) {
    return parts
        .map((part) => slugFromText(part || ""))
        .filter(Boolean)
        .join("::");
}

const EXIF_LOCATION_MATCH_DISTANCE_METERS = 100;

function toRadians(value: number) {
    return (value * Math.PI) / 180;
}

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
    const earthRadius = 6371000;
    const dLat = toRadians(b.lat - a.lat);
    const dLng = toRadians(b.lng - a.lng);
    const lat1 = toRadians(a.lat);
    const lat2 = toRadians(b.lat);

    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const h = sinLat * sinLat + sinLng * sinLng * Math.cos(lat1) * Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    return earthRadius * c;
}

function buildUniqueSlug(base: string, currentAssetId?: number) {
    const cleanBase = slugFromText(base);
    let slug = cleanBase;
    let suffix = 2;
    while (true) {
        const existing = db
            .select({ id: mediaAssets.id })
            .from(mediaAssets)
            .where(eq(mediaAssets.slug, slug))
            .limit(1)
            .get();
        if (!existing || existing.id === currentAssetId) {
            return slug;
        }
        slug = `${cleanBase}-${suffix++}`;
    }
}

const assetListSelect = {
    id: mediaAssets.id,
    title: mediaAssets.title,
    slug: mediaAssets.slug,
    description: mediaAssets.description,
    media_type: mediaAssets.mediaType,
    storage_id: mediaAssets.storageId,
    object_key: mediaAssets.objectKey,
    filename: mediaAssets.filename,
    object_url: mediaAssets.objectUrl,
    thumbnail_url: mediaAssets.thumbnailUrl,
    mime_type: mediaAssets.mimeType,
    size_bytes: mediaAssets.sizeBytes,
    status: mediaAssets.status,
    visibility: mediaAssets.visibility,
    lifecycle_status: mediaAssets.lifecycleStatus,
    integrity_status: mediaAssets.integrityStatus,
    integrity_message: mediaAssets.integrityMessage,
    last_verified_at: mediaAssets.lastVerifiedAt,
    trashed_at: mediaAssets.trashedAt,
    warnings_json: storageObjects.warningsJson,
    metadata_json: mediaAssets.metadataJson,
    created_at: mediaAssets.createdAt,
    updated_at: mediaAssets.updatedAt,
};

function readAssetTags(assetId: number) {
    return db
        .select({ slug: tags.slug })
        .from(mediaTags)
        .innerJoin(tags, eq(tags.id, mediaTags.tagId))
        .where(eq(mediaTags.assetId, assetId))
        .orderBy(asc(tags.slug))
        .all()
        .map((item) => item.slug);
}

function readAssetCollections(assetId: number) {
    return db
        .select({
            id: collections.id,
            title: collections.title,
            kind: collections.kind,
        })
        .from(collectionAssets)
        .innerJoin(collections, eq(collections.id, collectionAssets.collectionId))
        .where(eq(collectionAssets.assetId, assetId))
        .orderBy(asc(collectionAssets.position), asc(collections.title))
        .all();
}

function readAssetLocations(assetId: number) {
    return db
        .select({
            id: assetLocations.id,
            asset_id: assetLocations.assetId,
            content_type: assetLocations.contentType,
            label: assetLocations.label,
            raw_address: assetLocations.rawAddress,
            formatted_address: assetLocations.formattedAddress,
            google_place_id: assetLocations.googlePlaceId,
            lat: assetLocations.lat,
            lng: assetLocations.lng,
            is_primary: assetLocations.isPrimary,
            source: assetLocations.source,
            source_ref: assetLocations.sourceRef,
            status: assetLocations.status,
            raw_response_json: assetLocations.rawResponseJson,
            created_at: assetLocations.createdAt,
            updated_at: assetLocations.updatedAt,
        })
        .from(assetLocations)
        .where(eq(assetLocations.assetId, assetId))
        .orderBy(desc(assetLocations.isPrimary), asc(assetLocations.id))
        .all();
}

function readLatestStorageObject(assetId: number) {
    const row = db
        .select({
            warnings_json: storageObjects.warningsJson,
            sync_status: storageObjects.syncStatus,
            last_error: storageObjects.lastError,
        })
        .from(storageObjects)
        .where(eq(storageObjects.assetId, assetId))
        .orderBy(desc(storageObjects.id))
        .limit(1)
        .get();
    return row;
}

function mapLocationRefreshCandidate(row: {
    id: number;
    asset_id: number;
    media_type: AssetMatch["media_type"];
    source: string | null;
    status: string | null;
    label: string | null;
    raw_address: string | null;
    formatted_address: string | null;
}): LocationRefreshCandidate {
    return {
        id: Number(row.id),
        assetId: Number(row.asset_id),
        mediaType: row.media_type,
        source: row.source,
        status: row.status,
        label: row.label,
        rawAddress: row.raw_address,
        formattedAddress: row.formatted_address,
    };
}

function hasRefreshableAddress(candidate: LocationRefreshCandidate) {
    return Boolean(candidate.rawAddress || candidate.formattedAddress || candidate.label);
}

export function resolveCreatedByUserId(userId: string | null | undefined) {
    const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
    if (!normalizedUserId) return null;

    const existingUser = db
        .select({ id: authUser.id })
        .from(authUser)
        .where(eq(authUser.id, normalizedUserId))
        .limit(1)
        .get();

    return existingUser?.id || null;
}

export function listMediaAssets(filters?: {
    query?: string;
    mediaType?: string;
    status?: string;
    visibility?: string;
    lifecycleStatus?: AssetLifecycleStatus | "all";
    integrityStatus?: AssetIntegrityStatus | "all";
}) {
    const conditions = [] as Array<ReturnType<typeof eq> | ReturnType<typeof or>>;

    if (filters?.query) {
        const query = `%${filters.query}%`;
        conditions.push(
            or(
                like(mediaAssets.title, query),
                like(mediaAssets.slug, query),
                like(mediaAssets.objectKey, query)
            )
        );
    }
    if (filters?.mediaType && filters.mediaType !== "all") {
        conditions.push(eq(mediaAssets.mediaType, filters.mediaType as AssetMatch["media_type"]));
    }
    if (filters?.status && filters.status !== "all") {
        conditions.push(eq(mediaAssets.status, filters.status as RawAssetRecord["status"]));
    }
    if (filters?.visibility && filters.visibility !== "all") {
        conditions.push(eq(mediaAssets.visibility, filters.visibility as RawAssetRecord["visibility"]));
    }
    if (!filters?.lifecycleStatus || filters.lifecycleStatus === "active") {
        conditions.push(eq(mediaAssets.lifecycleStatus, "active"));
    } else if (filters.lifecycleStatus !== "all") {
        conditions.push(eq(mediaAssets.lifecycleStatus, filters.lifecycleStatus));
    }
    if (filters?.integrityStatus && filters.integrityStatus !== "all") {
        conditions.push(eq(mediaAssets.integrityStatus, filters.integrityStatus));
    }

    const rows = db
        .select(assetListSelect)
        .from(mediaAssets)
        .leftJoin(
            storageObjects,
            and(
                eq(storageObjects.assetId, mediaAssets.id),
                eq(storageObjects.storageId, mediaAssets.storageId),
                eq(storageObjects.objectKey, mediaAssets.objectKey)
            )
        )
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(mediaAssets.updatedAt), desc(mediaAssets.id))
        .all();

    return rows.map((row) => ({
        ...normalizeAssetRow(row as SelectedAssetRow),
        warnings: parseJsonArray(row.warnings_json),
        tags: readAssetTags(Number(row.id)),
        collections: readAssetCollections(Number(row.id)).map((item) => ({ title: item.title, kind: item.kind })),
    }));
}

export function getMediaAssetById(id: number) {
    const asset = db
        .select({
            id: mediaAssets.id,
            title: mediaAssets.title,
            slug: mediaAssets.slug,
            description: mediaAssets.description,
            media_type: mediaAssets.mediaType,
            storage_id: mediaAssets.storageId,
            object_key: mediaAssets.objectKey,
            filename: mediaAssets.filename,
            object_url: mediaAssets.objectUrl,
            thumbnail_url: mediaAssets.thumbnailUrl,
            mime_type: mediaAssets.mimeType,
            size_bytes: mediaAssets.sizeBytes,
            status: mediaAssets.status,
            visibility: mediaAssets.visibility,
            lifecycle_status: mediaAssets.lifecycleStatus,
            integrity_status: mediaAssets.integrityStatus,
            integrity_message: mediaAssets.integrityMessage,
            last_verified_at: mediaAssets.lastVerifiedAt,
            trashed_at: mediaAssets.trashedAt,
            metadata_json: mediaAssets.metadataJson,
            created_at: mediaAssets.createdAt,
            updated_at: mediaAssets.updatedAt,
        })
        .from(mediaAssets)
        .where(eq(mediaAssets.id, id))
        .limit(1)
        .get();
    if (!asset) return null;

    const tags = readAssetTags(id);
    const collections = readAssetCollections(id);
    const locations = readAssetLocations(id);
    const storageObject = readLatestStorageObject(id);

    const photoExif = getStoredPhotoExif(id);
    const locationConflicts = listLocationConflictRows(eq(assetLocationConflicts.assetId, id));

    return {
        ...normalizeAssetRow(asset as SelectedAssetRow),
        warnings: parseJsonArray(storageObject?.warnings_json),
        syncStatus: storageObject?.sync_status || "normalized",
        lastError: storageObject?.last_error || null,
        tags,
        collections,
        locations,
        photoExif,
        locationConflicts,
    };
}

export function archiveMediaAsset(assetId: number) {
    db.update(mediaAssets)
        .set({
            status: "archived",
            updatedAt: now(),
        })
        .where(eq(mediaAssets.id, assetId))
        .run();
}

export function trashMediaAsset(assetId: number) {
    const timestamp = now();
    db.update(mediaAssets)
        .set({
            lifecycleStatus: "trashed",
            trashedAt: timestamp,
            updatedAt: timestamp,
        })
        .where(eq(mediaAssets.id, assetId))
        .run();
}

export function restoreMediaAsset(assetId: number) {
    db.update(mediaAssets)
        .set({
            lifecycleStatus: "active",
            trashedAt: null,
            updatedAt: now(),
        })
        .where(eq(mediaAssets.id, assetId))
        .run();
}

export function permanentlyDeleteMediaAsset(assetId: number) {
    db.delete(mediaAssets).where(eq(mediaAssets.id, assetId)).run();
}

export function setAssetIntegrity(assetId: number, input: {
    integrityStatus: AssetIntegrityStatus;
    integrityMessage: string | null;
}) {
    const timestamp = now();
    db.update(mediaAssets)
        .set({
            integrityStatus: input.integrityStatus,
            integrityMessage: input.integrityMessage,
            lastVerifiedAt: timestamp,
            updatedAt: timestamp,
        })
        .where(eq(mediaAssets.id, assetId))
        .run();
}

export function listAssetsForIntegrity(filters?: { lifecycleStatus?: AssetLifecycleStatus }) {
    return db
        .select({
            id: mediaAssets.id,
            storage_id: mediaAssets.storageId,
            object_key: mediaAssets.objectKey,
        })
        .from(mediaAssets)
        .where(eq(mediaAssets.lifecycleStatus, filters?.lifecycleStatus || "active"))
        .orderBy(asc(mediaAssets.id))
        .all() as IntegrityAssetRecord[];
}

export function findMediaAssetByReference(input: { assetId?: number | null; objectKey?: string | null }) {
    if (input.assetId) {
        const row = db
            .select({
                id: mediaAssets.id,
                title: mediaAssets.title,
                media_type: mediaAssets.mediaType,
            })
            .from(mediaAssets)
            .where(eq(mediaAssets.id, input.assetId))
            .limit(1)
            .get();
        return row as AssetMatch | undefined;
    }

    if (input.objectKey) {
        const row = db
            .select({
                id: mediaAssets.id,
                title: mediaAssets.title,
                media_type: mediaAssets.mediaType,
            })
            .from(mediaAssets)
            .where(eq(mediaAssets.objectKey, input.objectKey))
            .limit(1)
            .get();
        return row as AssetMatch | undefined;
    }

    return undefined;
}

export function getRefreshableLocationForAsset(assetId: number) {
    const rows = db
        .select({
            id: assetLocations.id,
            asset_id: assetLocations.assetId,
            media_type: mediaAssets.mediaType,
            source: assetLocations.source,
            status: assetLocations.status,
            label: assetLocations.label,
            raw_address: assetLocations.rawAddress,
            formatted_address: assetLocations.formattedAddress,
        })
        .from(assetLocations)
        .innerJoin(mediaAssets, eq(mediaAssets.id, assetLocations.assetId))
        .where(and(eq(assetLocations.assetId, assetId), ne(assetLocations.source, "exif")))
        .orderBy(desc(assetLocations.isPrimary), asc(assetLocations.id))
        .all()
        .map(mapLocationRefreshCandidate);

    return rows.find(hasRefreshableAddress) || null;
}

export function listRefreshableLocations(options?: { mode?: "pending" | "force"; limit?: number }) {
    const conditions = [ne(assetLocations.source, "exif")];
    if (options?.mode !== "force") {
        conditions.push(inArray(assetLocations.status, ["pending", "failed"]));
    }

    const query = db
        .select({
            id: assetLocations.id,
            asset_id: assetLocations.assetId,
            media_type: mediaAssets.mediaType,
            source: assetLocations.source,
            status: assetLocations.status,
            label: assetLocations.label,
            raw_address: assetLocations.rawAddress,
            formatted_address: assetLocations.formattedAddress,
        })
        .from(assetLocations)
        .innerJoin(mediaAssets, eq(mediaAssets.id, assetLocations.assetId))
        .where(and(...conditions))
        .orderBy(asc(assetLocations.assetId), desc(assetLocations.isPrimary), asc(assetLocations.id));

    const rows = (typeof options?.limit === "number" ? query.limit(options.limit) : query).all();
    return rows.map(mapLocationRefreshCandidate).filter(hasRefreshableAddress);
}

export function applyGeocodeToLocation(locationId: number, input: {
    formattedAddress: string;
    googlePlaceId?: string;
    lat: number;
    lng: number;
    rawResponseJson: string;
}) {
    db.update(assetLocations)
        .set({
            formattedAddress: input.formattedAddress,
            googlePlaceId: input.googlePlaceId || null,
            lat: input.lat,
            lng: input.lng,
            status: "geocoded",
            rawResponseJson: input.rawResponseJson,
            updatedAt: now(),
        })
        .where(eq(assetLocations.id, locationId))
        .run();
}

export function markLocationGeocodeFailed(locationId: number) {
    db.update(assetLocations)
        .set({
            status: "failed",
            updatedAt: now(),
        })
        .where(eq(assetLocations.id, locationId))
        .run();
}

export function getDashboardStats() {
    const reviewRow = db
        .select({ count: count() })
        .from(mediaAssets)
        .where(inArray(mediaAssets.status, ["draft", "review"]))
        .get();

    const publishedRow = db
        .select({ count: count() })
        .from(mediaAssets)
        .where(eq(mediaAssets.status, "published"))
        .get();

    const warningRow = db
        .select({ count: count() })
        .from(storageObjects)
        .where(eq(storageObjects.syncStatus, "warning"))
        .get();

    const invalidRow = db
        .select({ count: count() })
        .from(storageObjects)
        .where(eq(storageObjects.syncStatus, "invalid"))
        .get();

    const primaryLocationAssetIds = new Set(
        db
            .selectDistinct({ assetId: assetLocations.assetId })
            .from(assetLocations)
            .where(eq(assetLocations.isPrimary, true))
            .all()
            .map((row) => row.assetId)
    );

    const assetCountRow = db.select({ count: count() }).from(mediaAssets).get();

    return {
        assets: assetCountRow?.count || 0,
        review: reviewRow?.count || 0,
        warnings: warningRow?.count || 0,
        invalid: invalidRow?.count || 0,
        missingLocation: (assetCountRow?.count || 0) - primaryLocationAssetIds.size,
        published: publishedRow?.count || 0,
    };
}

export function listStorageReviewItems(limit = 100) {
    return db
        .select({
            id: storageObjects.id,
            object_key: storageObjects.objectKey,
            sync_status: storageObjects.syncStatus,
            last_error: storageObjects.lastError,
            warnings_json: storageObjects.warningsJson,
        })
        .from(storageObjects)
        .where(inArray(storageObjects.syncStatus, ["warning", "invalid"]))
        .orderBy(desc(storageObjects.syncedAt), desc(storageObjects.id))
        .limit(limit)
        .all()
        .map((row) => ({
            ...row,
            warnings: parseJsonArray(row.warnings_json),
        })) as StorageReviewItem[];
}

export function upsertStorageObject(input: {
    storageId: string;
    folderType: "images" | "videos" | "gifs" | "misc";
    objectKey: string;
    objectUrl?: string | null;
    mimeType?: string | null;
    sizeBytes: number;
    checksum?: string | null;
    eTag?: string | null;
    lastModified?: number | null;
    syncStatus: "discovered" | "normalized" | "warning" | "invalid";
    warnings: string[];
    assetId?: number | null;
    lastError?: string | null;
}) {
    const syncedAt = now();
    db.insert(storageObjects)
        .values({
            storageId: input.storageId,
            folderType: input.folderType,
            objectKey: input.objectKey,
            objectUrl: input.objectUrl || null,
            mimeType: input.mimeType || null,
            sizeBytes: input.sizeBytes,
            checksum: input.checksum || null,
            eTag: input.eTag || null,
            lastModified: toDate(input.lastModified),
            syncedAt,
            syncStatus: input.syncStatus,
            warningsJson: JSON.stringify(input.warnings),
            assetId: input.assetId || null,
            lastError: input.lastError || null,
        })
        .onConflictDoUpdate({
            target: [storageObjects.storageId, storageObjects.objectKey],
            set: {
                objectUrl: input.objectUrl || null,
                mimeType: input.mimeType || null,
                sizeBytes: input.sizeBytes,
                checksum: input.checksum || null,
                eTag: input.eTag || null,
                lastModified: toDate(input.lastModified),
                syncedAt,
                syncStatus: input.syncStatus,
                warningsJson: JSON.stringify(input.warnings),
                assetId: input.assetId || null,
                lastError: input.lastError || null,
            },
        })
        .run();
}

export function upsertMediaAssetFromObject(input: {
    title: string;
    mediaType: "image" | "video";
    storageId: string;
    objectKey: string;
    objectUrl?: string | null;
    mimeType?: string | null;
    sizeBytes: number;
    createdBy?: string | null;
    width?: number | null;
    height?: number | null;
    warnings: string[];
    filename?: string | null;
}) {
    const existing = db
        .select({ id: mediaAssets.id })
        .from(mediaAssets)
        .where(and(eq(mediaAssets.storageId, input.storageId), eq(mediaAssets.objectKey, input.objectKey)))
        .limit(1)
        .get();
    const slug = buildUniqueSlug(input.title, existing?.id);
    const effectiveStatus = input.warnings.length > 0 ? "review" : "draft";
    const width = input.width ?? null;
    const height = input.height ?? null;
    const createdBy = resolveCreatedByUserId(input.createdBy);

    if (existing) {
        db.update(mediaAssets)
            .set({
                title: input.title,
                slug,
                mediaType: input.mediaType,
                filename: input.filename ?? null,
                objectUrl: input.objectUrl || null,
                mimeType: input.mimeType || null,
                sizeBytes: input.sizeBytes,
                width,
                height,
                status: effectiveStatus,
                updatedAt: now(),
            })
            .where(eq(mediaAssets.id, existing.id))
            .run();
        return existing.id;
    }

    const created = db
        .insert(mediaAssets)
        .values({
            title: input.title,
            slug,
            mediaType: input.mediaType,
            storageId: input.storageId,
            objectKey: input.objectKey,
            filename: input.filename ?? null,
            objectUrl: input.objectUrl || null,
            mimeType: input.mimeType || null,
            sizeBytes: input.sizeBytes,
            width,
            height,
            status: effectiveStatus,
            visibility: "private",
            createdAt: now(),
            updatedAt: now(),
            createdBy,
        })
        .returning({ id: mediaAssets.id })
        .get();
    return Number(created.id);
}

function ensureTag(slug: string) {
    const normalized = slugFromText(slug);
    const existing = db.select({ id: tags.id }).from(tags).where(eq(tags.slug, normalized)).limit(1).get();
    if (existing) return existing.id;
    const created = db
        .insert(tags)
        .values({
            label: normalized,
            slug: normalized,
            createdAt: now(),
        })
        .returning({ id: tags.id })
        .get();
    return Number(created.id);
}

function ensureCollection(name: string) {
    const baseSlug = slugFromText(name);
    const existing = db
        .select({ id: collections.id })
        .from(collections)
        .where(eq(collections.slug, baseSlug))
        .limit(1)
        .get();
    if (existing) return existing.id;
    const slug = buildUniqueSlug(name);
    const created = db
        .insert(collections)
        .values({
            title: name.trim(),
            slug,
            kind: "collection",
            createdAt: now(),
            updatedAt: now(),
        })
        .returning({ id: collections.id })
        .get();
    return Number(created.id);
}

function replaceAssetTags(assetId: number, tagSlugs: string[]) {
    db.delete(mediaTags).where(eq(mediaTags.assetId, assetId)).run();
    for (const slug of tagSlugs) {
        const tagId = ensureTag(slug);
        db.insert(mediaTags)
            .values({
                assetId,
                tagId,
                appliedAt: now(),
            })
            .run();
    }
}

function replaceAssetCollections(assetId: number, collectionNames: string[]) {
    db.delete(collectionAssets).where(eq(collectionAssets.assetId, assetId)).run();
    collectionNames.forEach((name, index) => {
        const collectionId = ensureCollection(name.trim());
        db.insert(collectionAssets)
            .values({
                collectionId,
                assetId,
                position: index,
                addedAt: now(),
            })
            .run();
    });
}

function replaceAssetLocations(assetId: number, locations: AssetLocationInput[]) {
    db.delete(assetLocations)
        .where(and(eq(assetLocations.assetId, assetId), ne(assetLocations.source, "exif")))
        .run();
    for (const location of locations) {
        db.insert(assetLocations)
            .values({
                assetId,
                contentType: "media",
                label: location.label || null,
                rawAddress: location.rawAddress || null,
                formattedAddress: location.formattedAddress || null,
                googlePlaceId: location.googlePlaceId || null,
                lat: location.lat ?? null,
                lng: location.lng ?? null,
                isPrimary: !!location.isPrimary,
                source: location.source || "manual",
                sourceRef: location.sourceRef || null,
                status: location.status || "pending",
                rawResponseJson: location.rawResponseJson || null,
                createdAt: now(),
                updatedAt: now(),
            })
            .run();
    }

    reconcileStoredExifLocation(assetId);
}

export function saveImportedLocation(
    assetId: number,
    mediaType: AssetMatch["media_type"],
    location: AssetLocationInput
) {
    if (mediaType === "image") {
        db.delete(assetLocations)
            .where(and(eq(assetLocations.assetId, assetId), ne(assetLocations.source, "exif")))
            .run();
    } else if (location.isPrimary) {
        db.update(assetLocations)
            .set({ isPrimary: false })
            .where(eq(assetLocations.assetId, assetId))
            .run();
    }

    db.insert(assetLocations)
        .values({
            assetId,
            contentType: "media",
            label: location.label || null,
            rawAddress: location.rawAddress || null,
            formattedAddress: location.formattedAddress || null,
            googlePlaceId: location.googlePlaceId || null,
            lat: location.lat ?? null,
            lng: location.lng ?? null,
            isPrimary: !!location.isPrimary,
            source: location.source || "import",
            sourceRef: location.sourceRef || null,
            status: location.status || "pending",
            rawResponseJson: location.rawResponseJson || null,
            createdAt: now(),
            updatedAt: now(),
        })
        .run();

    reconcileStoredExifLocation(assetId);
}

const existingConflictLocation = alias(assetLocations, "existing_conflict_location");
const candidateConflictLocation = alias(assetLocations, "candidate_conflict_location");

function safeNumber(value: unknown): number | null {
    if (value == null) return null;
    const numeric = Number(value);
    return Number.isNaN(numeric) ? null : numeric;
}

function safeString(value: unknown): string | null {
    if (value == null) return null;
    return String(value);
}

function mapConflictRow(row: Record<string, unknown>): LocationConflictRecord {
    const resolutionValue =
        row.resolution === "keep_exif" || row.resolution === "keep_existing"
            ? (row.resolution as LocationConflictResolution)
            : null;
    const statusValue = row.status === "resolved" ? "resolved" : "pending";

    return {
        id: Number(row.id),
        assetId: Number(row.asset_id),
        assetTitle: safeString(row.asset_title) || "",
        distanceMeters: safeNumber(row.distance_meters),
        existingLocation: {
            id: safeNumber(row.existing_location_id),
            label: safeString(row.existing_label),
            source: safeString(row.existing_source),
            lat: safeNumber(row.existing_lat),
            lng: safeNumber(row.existing_lng),
        },
        candidateLocation: {
            id: safeNumber(row.candidate_location_id),
            source: safeString(row.candidate_source),
            lat: safeNumber(row.candidate_lat),
            lng: safeNumber(row.candidate_lng),
            createdAt: toMillis(row.candidate_created_at),
        },
        status: statusValue,
        resolution: resolutionValue,
        resolvedBy: safeString(row.resolved_by),
        createdAt: toMillis(row.created_at) || 0,
        resolvedAt: toMillis(row.resolved_at),
    };
}

function listLocationConflictRows(whereCondition?: ReturnType<typeof eq>, limit?: number) {
    const query = db
        .select({
            id: assetLocationConflicts.id,
            asset_id: assetLocationConflicts.assetId,
            asset_title: mediaAssets.title,
            distance_meters: assetLocationConflicts.distanceMeters,
            status: assetLocationConflicts.status,
            resolution: assetLocationConflicts.resolution,
            resolved_by: assetLocationConflicts.resolvedBy,
            created_at: assetLocationConflicts.createdAt,
            resolved_at: assetLocationConflicts.resolvedAt,
            existing_location_id: existingConflictLocation.id,
            existing_label: existingConflictLocation.label,
            existing_source: existingConflictLocation.source,
            existing_lat: existingConflictLocation.lat,
            existing_lng: existingConflictLocation.lng,
            candidate_location_id: candidateConflictLocation.id,
            candidate_source: candidateConflictLocation.source,
            candidate_lat: candidateConflictLocation.lat,
            candidate_lng: candidateConflictLocation.lng,
            candidate_created_at: candidateConflictLocation.createdAt,
        })
        .from(assetLocationConflicts)
        .innerJoin(mediaAssets, eq(mediaAssets.id, assetLocationConflicts.assetId))
        .leftJoin(
            existingConflictLocation,
            eq(existingConflictLocation.id, assetLocationConflicts.existingLocationId)
        )
        .leftJoin(
            candidateConflictLocation,
            eq(candidateConflictLocation.id, assetLocationConflicts.candidateLocationId)
        )
        .where(whereCondition)
        .orderBy(desc(assetLocationConflicts.createdAt), desc(assetLocationConflicts.id));

    const rows = (typeof limit === "number" ? query.limit(limit) : query).all();
    return (rows as Record<string, unknown>[]).map(mapConflictRow);
}

function fetchConflictById(conflictId: number) {
    return listLocationConflictRows(eq(assetLocationConflicts.id, conflictId), 1)[0] || null;
}

export function upsertPhotoExif(assetId: number, input: PhotoExifInput) {
    const timestamp = now();
    const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;
    const gpsLat = input.location?.lat ?? null;
    const gpsLng = input.location?.lng ?? null;
    const gpsAltitude = input.location?.altitude ?? null;
    const cameraId =
        input.camera?.model || input.camera?.make
            ? ensurePhotoCamera(input.camera?.make || null, input.camera?.model || "Unknown camera")
            : null;
    const lensId = input.lens?.model ? ensurePhotoLens(input.lens.model) : null;
    const capturedAt = input.captureDate ? Date.parse(input.captureDate) : null;

    const values = {
        assetId,
        cameraId,
        lensId,
        capturedAt: Number.isFinite(capturedAt) ? new Date(capturedAt as number) : null,
        pixelWidth: input.pixelWidth ?? null,
        pixelHeight: input.pixelHeight ?? null,
        focalLengthMm: input.focalLength ?? null,
        apertureFNumber: input.aperture ?? null,
        exposureTimeText: input.exposureTime || null,
        iso: input.iso ?? null,
        orientation: input.orientation ?? null,
        software: input.software || null,
        gpsLat,
        gpsLng,
        gpsAltitudeM: gpsAltitude,
        metadataJson,
        createdAt: timestamp,
        updatedAt: timestamp,
    };

    db.insert(photoExif)
        .values(values)
        .onConflictDoUpdate({
            target: photoExif.assetId,
            set: {
                cameraId,
                lensId,
                capturedAt: Number.isFinite(capturedAt) ? new Date(capturedAt as number) : null,
                pixelWidth: input.pixelWidth ?? null,
                pixelHeight: input.pixelHeight ?? null,
                focalLengthMm: input.focalLength ?? null,
                apertureFNumber: input.aperture ?? null,
                exposureTimeText: input.exposureTime || null,
                iso: input.iso ?? null,
                orientation: input.orientation ?? null,
                software: input.software || null,
                gpsLat,
                gpsLng,
                gpsAltitudeM: gpsAltitude,
                metadataJson,
                updatedAt: timestamp,
            },
        })
        .run();
}

function ensurePhotoCamera(make: string | null, model: string) {
    const normalizedKey = normalizeExifKey(make, model);
    const existing = db
        .select({ id: photoCameras.id })
        .from(photoCameras)
        .where(eq(photoCameras.normalizedKey, normalizedKey))
        .limit(1)
        .get();
    if (existing) return existing.id;

    const created = db
        .insert(photoCameras)
        .values({
            make,
            model,
            normalizedKey,
            createdAt: now(),
        })
        .returning({ id: photoCameras.id })
        .get();
    return Number(created.id);
}

function ensurePhotoLens(label: string) {
    const trimmedLabel = label.trim();
    const normalizedKey = normalizeExifKey(trimmedLabel);
    const existing = db
        .select({ id: photoLenses.id })
        .from(photoLenses)
        .where(eq(photoLenses.normalizedKey, normalizedKey))
        .limit(1)
        .get();
    if (existing) return existing.id;

    const created = db
        .insert(photoLenses)
        .values({
            label: trimmedLabel || "Unknown lens",
            normalizedKey,
            createdAt: now(),
        })
        .returning({ id: photoLenses.id })
        .get();
    return Number(created.id);
}

function getStoredPhotoExif(assetId: number): PhotoExifInput | null {
    const row = db
        .select({
            captured_at: photoExif.capturedAt,
            pixel_width: photoExif.pixelWidth,
            pixel_height: photoExif.pixelHeight,
            focal_length_mm: photoExif.focalLengthMm,
            aperture_f_number: photoExif.apertureFNumber,
            exposure_time_text: photoExif.exposureTimeText,
            iso: photoExif.iso,
            orientation: photoExif.orientation,
            software: photoExif.software,
            gps_lat: photoExif.gpsLat,
            gps_lng: photoExif.gpsLng,
            gps_altitude_m: photoExif.gpsAltitudeM,
            metadata_json: photoExif.metadataJson,
            camera_make: photoCameras.make,
            camera_model: photoCameras.model,
            lens_label: photoLenses.label,
        })
        .from(photoExif)
        .leftJoin(photoCameras, eq(photoCameras.id, photoExif.cameraId))
        .leftJoin(photoLenses, eq(photoLenses.id, photoExif.lensId))
        .where(eq(photoExif.assetId, assetId))
        .limit(1)
        .get();
    if (!row) return null;

    return {
        captureDate:
            toMillis(row.captured_at) !== null
                ? new Date(toMillis(row.captured_at) as number).toISOString()
                : null,
        pixelWidth: safeNumber(row.pixel_width),
        pixelHeight: safeNumber(row.pixel_height),
        focalLength: safeNumber(row.focal_length_mm),
        aperture: safeNumber(row.aperture_f_number),
        exposureTime: safeString(row.exposure_time_text),
        iso: safeNumber(row.iso),
        orientation: safeNumber(row.orientation),
        software: safeString(row.software),
        camera: {
            make: safeString(row.camera_make),
            model: safeString(row.camera_model),
        },
        lens: {
            model: safeString(row.lens_label),
        },
        location:
            safeNumber(row.gps_lat) !== null && safeNumber(row.gps_lng) !== null
                ? {
                      lat: Number(row.gps_lat),
                      lng: Number(row.gps_lng),
                      altitude: safeNumber(row.gps_altitude_m),
                  }
                : null,
        metadata:
            typeof row.metadata_json === "string"
                ? (() => {
                      try {
                          return JSON.parse(row.metadata_json as string) as Record<string, unknown>;
                      } catch {
                          return null;
                      }
                  })()
                : null,
    };
}

export function reconcileStoredExifLocation(assetId: number) {
    const stored = getStoredPhotoExif(assetId);
    if (!stored) return null;
    return reconcileExifLocation(assetId, stored);
}

function upsertLocationConflictRow(params: {
    assetId: number;
    existingLocationId: number;
    candidateLocationId: number;
    distance: number | null;
    timestamp: Date;
}) {
    const existingConflict = db
        .select({ id: assetLocationConflicts.id })
        .from(assetLocationConflicts)
        .where(
            and(
                eq(assetLocationConflicts.assetId, params.assetId),
                eq(assetLocationConflicts.status, "pending")
            )
        )
        .orderBy(desc(assetLocationConflicts.id))
        .limit(1)
        .get();

    if (existingConflict) {
        db.update(assetLocationConflicts)
            .set({
                existingLocationId: params.existingLocationId,
                candidateLocationId: params.candidateLocationId,
                distanceMeters: params.distance,
                updatedAt: params.timestamp,
            })
            .where(eq(assetLocationConflicts.id, existingConflict.id))
            .run();
        return existingConflict.id;
    }

    const created = db
        .insert(assetLocationConflicts)
        .values({
            assetId: params.assetId,
            existingLocationId: params.existingLocationId,
            candidateLocationId: params.candidateLocationId,
            distanceMeters: params.distance,
            resolution: null,
            resolvedBy: null,
            resolvedAt: null,
            status: "pending",
            createdAt: params.timestamp,
            updatedAt: params.timestamp,
        })
        .returning({ id: assetLocationConflicts.id })
        .get();
    return Number(created.id);
}

function resolvePendingLocationConflicts(
    assetId: number,
    resolution: LocationConflictResolution,
    timestamp: Date
) {
    db.update(assetLocationConflicts)
        .set({
            resolution,
            resolvedBy: null,
            resolvedAt: timestamp,
            status: "resolved",
            updatedAt: timestamp,
        })
        .where(
            and(
                eq(assetLocationConflicts.assetId, assetId),
                eq(assetLocationConflicts.status, "pending")
            )
        )
        .run();
}

export function reconcileExifLocation(assetId: number, input: PhotoExifInput) {
    const location = input.location;
    if (!location || typeof location.lat !== "number" || typeof location.lng !== "number") {
        return null;
    }
    const timestamp = now();

    const existingCandidate = db
        .select({ id: assetLocations.id })
        .from(assetLocations)
        .where(and(eq(assetLocations.assetId, assetId), eq(assetLocations.source, "exif")))
        .limit(1)
        .get();
    let candidateId = existingCandidate?.id;

    if (candidateId) {
        db.update(assetLocations)
            .set({
                label: "EXIF GPS",
                lat: location.lat,
                lng: location.lng,
                source: "exif",
                sourceRef: "exif",
                status: "pending",
                updatedAt: timestamp,
            })
            .where(eq(assetLocations.id, candidateId))
            .run();
    } else {
        const inserted = db
            .insert(assetLocations)
            .values({
                assetId,
                contentType: "media",
                label: "EXIF GPS",
                lat: location.lat,
                lng: location.lng,
                isPrimary: false,
                source: "exif",
                sourceRef: "exif",
                status: "pending",
                createdAt: timestamp,
                updatedAt: timestamp,
            })
            .returning({ id: assetLocations.id })
            .get();
        candidateId = Number(inserted.id);
    }

    const existingLocation = db
        .select({
            id: assetLocations.id,
            lat: assetLocations.lat,
            lng: assetLocations.lng,
        })
        .from(assetLocations)
        .where(and(eq(assetLocations.assetId, assetId), ne(assetLocations.source, "exif")))
        .orderBy(desc(assetLocations.isPrimary), asc(assetLocations.id))
        .limit(1)
        .get();

    if (!existingLocation) {
        db.update(assetLocations)
            .set({
                isPrimary: true,
                status: "matched",
                updatedAt: timestamp,
            })
            .where(eq(assetLocations.id, candidateId))
            .run();
        resolvePendingLocationConflicts(assetId, "keep_exif", timestamp);
        return null;
    }

    const hasExistingCoords =
        typeof existingLocation.lat === "number" && typeof existingLocation.lng === "number";
    const distance = hasExistingCoords
        ? distanceMeters(
              { lat: location.lat, lng: location.lng },
              {
                  lat: existingLocation.lat as number,
                  lng: existingLocation.lng as number,
              }
          )
        : null;

    const conflictNeeded =
        !hasExistingCoords || (distance !== null && distance > EXIF_LOCATION_MATCH_DISTANCE_METERS);

    if (conflictNeeded) {
        db.update(assetLocations)
            .set({ isPrimary: false, updatedAt: timestamp })
            .where(eq(assetLocations.assetId, assetId))
            .run();
        db.update(assetLocations)
            .set({ status: "matched", updatedAt: timestamp })
            .where(eq(assetLocations.id, existingLocation.id))
            .run();
        db.update(assetLocations)
            .set({ isPrimary: true, status: "pending", updatedAt: timestamp })
            .where(eq(assetLocations.id, candidateId))
            .run();

        upsertLocationConflictRow({
            assetId,
            existingLocationId: existingLocation.id,
            candidateLocationId: candidateId,
            distance,
            timestamp,
        });
        return null;
    }

    db.update(assetLocations)
        .set({ isPrimary: false, status: "matched", updatedAt: timestamp })
        .where(eq(assetLocations.id, candidateId))
        .run();
    db.update(assetLocations)
        .set({ isPrimary: true, status: "matched", updatedAt: timestamp })
        .where(eq(assetLocations.id, existingLocation.id))
        .run();
    resolvePendingLocationConflicts(assetId, "keep_existing", timestamp);

    return null;
}

export function listPendingLocationConflicts(limit = 20) {
    return listLocationConflictRows(eq(assetLocationConflicts.status, "pending"), limit);
}

export function resolveAssetLocationConflict(
    conflictId: number,
    resolution: LocationConflictResolution,
    resolvedBy?: string | null
) {
    const conflictRow = db
        .select({
            asset_id: assetLocationConflicts.assetId,
            existing_location_id: assetLocationConflicts.existingLocationId,
            candidate_location_id: assetLocationConflicts.candidateLocationId,
        })
        .from(assetLocationConflicts)
        .where(eq(assetLocationConflicts.id, conflictId))
        .limit(1)
        .get();
    if (!conflictRow) {
        throw new Error("Location conflict not found");
    }
    if (!conflictRow.candidate_location_id || !conflictRow.existing_location_id) {
        throw new Error("Conflict missing location references");
    }

    const resolvedByUserId = resolveCreatedByUserId(resolvedBy);
    const timestamp = now();
    db.update(assetLocations)
        .set({ isPrimary: false, updatedAt: timestamp })
        .where(eq(assetLocations.assetId, conflictRow.asset_id))
        .run();

    if (resolution === "keep_exif") {
        db.update(assetLocations)
            .set({ isPrimary: true, status: "matched", updatedAt: timestamp })
            .where(eq(assetLocations.id, conflictRow.candidate_location_id))
            .run();
        db.update(assetLocations)
            .set({ status: "matched", updatedAt: timestamp })
            .where(eq(assetLocations.id, conflictRow.existing_location_id))
            .run();
    } else {
        db.update(assetLocations)
            .set({ isPrimary: true, status: "matched", updatedAt: timestamp })
            .where(eq(assetLocations.id, conflictRow.existing_location_id))
            .run();
        db.update(assetLocations)
            .set({ status: "matched", updatedAt: timestamp })
            .where(eq(assetLocations.id, conflictRow.candidate_location_id))
            .run();
    }

    db.update(assetLocationConflicts)
        .set({
            resolution,
            resolvedBy: resolvedByUserId,
            resolvedAt: timestamp,
            status: "resolved",
            updatedAt: timestamp,
        })
        .where(eq(assetLocationConflicts.id, conflictId))
        .run();

    return fetchConflictById(conflictId);
}

export function updateMediaAsset(assetId: number, input: AssetUpdateInput) {
    const existing = getMediaAssetById(assetId);
    if (!existing) {
        throw new Error("Asset not found");
    }

    const title = input.title?.trim() || existing.title;
    const filename = input.filename !== undefined ? input.filename : existing.filename;
    db.update(mediaAssets)
        .set({
            title,
            slug: buildUniqueSlug(title, assetId),
            description: input.description ?? existing.description ?? null,
            visibility: input.visibility || existing.visibility,
            status: input.status || existing.status,
            filename: filename ?? null,
            updatedAt: now(),
        })
        .where(eq(mediaAssets.id, assetId))
        .run();

    if (input.tagSlugs) {
        replaceAssetTags(assetId, input.tagSlugs.filter(Boolean));
    }
    if (input.collectionNames) {
        replaceAssetCollections(assetId, input.collectionNames.filter(Boolean));
    }
    if (input.locations) {
        replaceAssetLocations(assetId, input.locations);
    }

    return getMediaAssetById(assetId);
}

// ---------------------------------------------------------------- renditions

export type RenditionInput = {
    label: string;
    objectKey: string;
    objectUrl?: string | null;
    mimeType?: string | null;
    width?: number | null;
    height?: number | null;
    sizeBytes?: number | null;
};

/**
 * Replace an asset's rendition rows with exactly the set given.
 *
 * Delete-then-insert rather than upsert: a re-derive at different widths must
 * not leave rows describing objects the new run did not write. The unique index
 * is on (asset_id, label), so a stale `avif-2400` from an earlier run would
 * otherwise survive and point at an object that is no longer there.
 */
export function replaceAssetRenditions(assetId: number, renditions: RenditionInput[]) {
    // Drizzle runs the callback immediately and returns its result; it is not a
    // factory like better-sqlite3's own `.transaction()`.
    db.transaction((tx) => {
        tx.delete(mediaRenditions).where(eq(mediaRenditions.assetId, assetId)).run();
        for (const rendition of renditions) {
            tx.insert(mediaRenditions)
                .values({
                    assetId,
                    label: rendition.label,
                    objectKey: rendition.objectKey,
                    objectUrl: rendition.objectUrl ?? null,
                    mimeType: rendition.mimeType ?? null,
                    width: rendition.width ?? null,
                    height: rendition.height ?? null,
                    sizeBytes: rendition.sizeBytes ?? 0,
                })
                .run();
        }
    });
    return renditions.length;
}

export function listAssetRenditions(assetId: number) {
    return db
        .select()
        .from(mediaRenditions)
        .where(eq(mediaRenditions.assetId, assetId))
        .orderBy(asc(mediaRenditions.label))
        .all();
}

export function countAssetRenditions() {
    return db.select({ value: count() }).from(mediaRenditions).get()?.value ?? 0;
}

/**
 * Record measured intrinsic dimensions.
 *
 * Kept separate from the derive run itself because the plan requires the
 * measured-vs-declared diff to be reviewed rather than silently applied: a
 * mismatch can mean the master is not the file the catalog believes it is, and
 * overwriting on sight would erase the evidence.
 */
export function setAssetMeasuredDimensions(assetId: number, width: number, height: number) {
    db.update(mediaAssets)
        .set({ width, height, updatedAt: new Date() })
        .where(eq(mediaAssets.id, assetId))
        .run();
}

export function setAssetLqip(assetId: number, lqip: string) {
    const current = db
        .select({ metadataJson: mediaAssets.metadataJson })
        .from(mediaAssets)
        .where(eq(mediaAssets.id, assetId))
        .get();
    if (!current) return;

    let metadata: Record<string, unknown> = {};
    try {
        const parsed = JSON.parse(current.metadataJson || "{}");
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            metadata = parsed as Record<string, unknown>;
        }
    } catch {
        // Unparseable metadata is replaced rather than allowed to block the write.
    }

    metadata.lqip = lqip;
    db.update(mediaAssets)
        .set({ metadataJson: JSON.stringify(metadata), updatedAt: new Date() })
        .where(eq(mediaAssets.id, assetId))
        .run();
}

/**
 * Point the asset at a public thumbnail.
 *
 * The admin UI renders previews from `object_url`, which for these assets is
 * the master in a private bucket — the browser has no credentials, so every
 * preview is a broken image. The derived renditions are public, so the smallest
 * one is what the UI should actually load: correct, and a few KB instead of
 * tens of MB.
 */
export function setAssetThumbnail(assetId: number, objectKey: string, objectUrl: string | null) {
    db.update(mediaAssets)
        .set({ thumbnailKey: objectKey, thumbnailUrl: objectUrl, updatedAt: now() })
        .where(eq(mediaAssets.id, assetId))
        .run();
}
