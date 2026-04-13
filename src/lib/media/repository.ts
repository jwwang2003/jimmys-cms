import { sqlite } from "@/db";
import type {
    AssetIntegrityStatus,
    AssetLifecycleStatus,
    AssetLocationInput,
    AssetUpdateInput,
    ManagedMediaType,
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
    object_url: string | null;
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
    return Date.now();
}

function buildUniqueSlug(base: string, currentAssetId?: number) {
    const cleanBase = slugFromText(base);
    let slug = cleanBase;
    let suffix = 2;
    while (true) {
        const existing = sqlite
            .prepare("select id from media_assets where slug = ?")
            .get(slug) as { id: number } | undefined;
        if (!existing || existing.id === currentAssetId) {
            return slug;
        }
        slug = `${cleanBase}-${suffix++}`;
    }
}

export function listMediaAssets(filters?: {
    query?: string;
    mediaType?: string;
    status?: string;
    visibility?: string;
    lifecycleStatus?: AssetLifecycleStatus | "all";
    integrityStatus?: AssetIntegrityStatus | "all";
}) {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters?.query) {
        conditions.push("(ma.title like ? or ma.slug like ? or ma.object_key like ?)");
        const query = `%${filters.query}%`;
        params.push(query, query, query);
    }
    if (filters?.mediaType && filters.mediaType !== "all") {
        conditions.push("ma.media_type = ?");
        params.push(filters.mediaType);
    }
    if (filters?.status && filters.status !== "all") {
        conditions.push("ma.status = ?");
        params.push(filters.status);
    }
    if (filters?.visibility && filters.visibility !== "all") {
        conditions.push("ma.visibility = ?");
        params.push(filters.visibility);
    }
    if (!filters?.lifecycleStatus || filters.lifecycleStatus === "active") {
        conditions.push("ma.lifecycle_status = 'active'");
    } else if (filters.lifecycleStatus !== "all") {
        conditions.push("ma.lifecycle_status = ?");
        params.push(filters.lifecycleStatus);
    }
    if (filters?.integrityStatus && filters.integrityStatus !== "all") {
        conditions.push("ma.integrity_status = ?");
        params.push(filters.integrityStatus);
    }

    const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
    const rows = sqlite
        .prepare(`
            select
                ma.*,
                so.warnings_json
            from media_assets ma
            left join storage_objects so
                on so.asset_id = ma.id
                and so.storage_id = ma.storage_id
                and so.object_key = ma.object_key
            ${where}
            order by ma.updated_at desc, ma.id desc
        `)
        .all(...params) as RawAssetRecord[];

    return rows.map((row) => ({
        ...row,
        warnings: parseJsonArray(row.warnings_json),
        tags: sqlite
            .prepare(`
                select t.slug
                from media_tags mt
                join tags t on t.id = mt.tag_id
                where mt.asset_id = ?
                order by t.slug asc
            `)
            .all(row.id)
            .map((item) => (item as { slug: string }).slug),
        collections: sqlite
            .prepare(`
                select c.title, c.kind
                from collection_assets ca
                join collections c on c.id = ca.collection_id
                where ca.asset_id = ?
                order by ca.position asc, c.title asc
            `)
            .all(row.id),
    }));
}

export function getMediaAssetById(id: number) {
    const asset = sqlite.prepare("select * from media_assets where id = ?").get(id) as RawAssetRecord | undefined;
    if (!asset) return null;

    const tags = sqlite
        .prepare(`
            select t.slug
            from media_tags mt
            join tags t on t.id = mt.tag_id
            where mt.asset_id = ?
            order by t.slug asc
        `)
        .all(id)
        .map((item) => (item as { slug: string }).slug);

    const collections = sqlite
        .prepare(`
            select c.id, c.title, c.kind
            from collection_assets ca
            join collections c on c.id = ca.collection_id
            where ca.asset_id = ?
            order by ca.position asc, c.title asc
        `)
        .all(id);

    const locations = sqlite
        .prepare(`
            select *
            from asset_locations
            where asset_id = ?
            order by is_primary desc, id asc
        `)
        .all(id);

    const storageObject = sqlite
        .prepare(`
            select warnings_json, sync_status, last_error
            from storage_objects
            where asset_id = ?
            order by id desc
            limit 1
        `)
        .get(id) as { warnings_json?: string; sync_status?: string; last_error?: string | null } | undefined;

    return {
        ...asset,
        warnings: parseJsonArray(storageObject?.warnings_json),
        syncStatus: storageObject?.sync_status || "normalized",
        lastError: storageObject?.last_error || null,
        tags,
        collections,
        locations,
    };
}

export function archiveMediaAsset(assetId: number) {
    sqlite
        .prepare(`
            update media_assets
            set status = 'archived',
                updated_at = ?
            where id = ?
        `)
        .run(now(), assetId);
}

export function trashMediaAsset(assetId: number) {
    const timestamp = now();
    sqlite
        .prepare(`
            update media_assets
            set lifecycle_status = 'trashed',
                trashed_at = ?,
                updated_at = ?
            where id = ?
        `)
        .run(timestamp, timestamp, assetId);
}

export function restoreMediaAsset(assetId: number) {
    sqlite
        .prepare(`
            update media_assets
            set lifecycle_status = 'active',
                trashed_at = null,
                updated_at = ?
            where id = ?
        `)
        .run(now(), assetId);
}

export function permanentlyDeleteMediaAsset(assetId: number) {
    sqlite.prepare("delete from media_assets where id = ?").run(assetId);
}

export function findMediaAssetByReference(input: { assetId?: number | null; objectKey?: string | null }) {
    if (input.assetId) {
        return sqlite
            .prepare("select id, title, media_type from media_assets where id = ?")
            .get(input.assetId) as AssetMatch | undefined;
    }

    if (input.objectKey) {
        return sqlite
            .prepare("select id, title, media_type from media_assets where object_key = ?")
            .get(input.objectKey) as AssetMatch | undefined;
    }

    return undefined;
}

export function getDashboardStats() {
    const readCount = (sql: string) => {
        const row = sqlite.prepare(sql).get() as { count: number };
        return row?.count || 0;
    };

    return {
        assets: readCount("select count(*) as count from media_assets"),
        review: readCount("select count(*) as count from media_assets where status in ('draft', 'review')"),
        warnings: readCount("select count(*) as count from storage_objects where sync_status = 'warning'"),
        invalid: readCount("select count(*) as count from storage_objects where sync_status = 'invalid'"),
        missingLocation: readCount(`
            select count(*) as count
            from media_assets ma
            where not exists (
                select 1 from asset_locations al
                where al.asset_id = ma.id and al.is_primary = 1
            )
        `),
        published: readCount("select count(*) as count from media_assets where status = 'published'"),
    };
}

export function listStorageReviewItems(limit = 100) {
    return sqlite
        .prepare(`
            select *
            from storage_objects
            where sync_status in ('warning', 'invalid')
            order by synced_at desc, id desc
            limit ?
        `)
        .all(limit)
        .map((row) => ({
            ...(row as Record<string, unknown>),
            warnings: parseJsonArray((row as { warnings_json?: string }).warnings_json),
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
    sqlite
        .prepare(`
            insert into storage_objects (
                storage_id,
                folder_type,
                object_key,
                object_url,
                mime_type,
                size_bytes,
                checksum,
                etag,
                last_modified,
                synced_at,
                sync_status,
                warnings_json,
                asset_id,
                last_error
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            on conflict(storage_id, object_key)
            do update set
                object_url = excluded.object_url,
                mime_type = excluded.mime_type,
                size_bytes = excluded.size_bytes,
                checksum = excluded.checksum,
                etag = excluded.etag,
                last_modified = excluded.last_modified,
                synced_at = excluded.synced_at,
                sync_status = excluded.sync_status,
                warnings_json = excluded.warnings_json,
                asset_id = excluded.asset_id,
                last_error = excluded.last_error
        `)
        .run(
            input.storageId,
            input.folderType,
            input.objectKey,
            input.objectUrl || null,
            input.mimeType || null,
            input.sizeBytes,
            input.checksum || null,
            input.eTag || null,
            input.lastModified || null,
            now(),
            input.syncStatus,
            JSON.stringify(input.warnings),
            input.assetId || null,
            input.lastError || null
        );
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
    warnings: string[];
}) {
    const existing = sqlite
        .prepare("select id from media_assets where storage_id = ? and object_key = ?")
        .get(input.storageId, input.objectKey) as { id: number } | undefined;
    const slug = buildUniqueSlug(input.title, existing?.id);
    const effectiveStatus = input.warnings.length > 0 ? "review" : "draft";

    if (existing) {
        sqlite
            .prepare(`
                update media_assets
                set title = ?,
                    slug = ?,
                    media_type = ?,
                    object_url = ?,
                    mime_type = ?,
                    size_bytes = ?,
                    status = ?,
                    updated_at = ?
                where id = ?
            `)
            .run(
                input.title,
                slug,
                input.mediaType,
                input.objectUrl || null,
                input.mimeType || null,
                input.sizeBytes,
                effectiveStatus,
                now(),
                existing.id
            );
        return existing.id;
    }

    const result = sqlite
        .prepare(`
            insert into media_assets (
                title,
                slug,
                media_type,
                storage_id,
                object_key,
                object_url,
                mime_type,
                size_bytes,
                status,
                visibility,
                created_at,
                updated_at,
                created_by
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'private', ?, ?, ?)
        `)
        .run(
            input.title,
            slug,
            input.mediaType,
            input.storageId,
            input.objectKey,
            input.objectUrl || null,
            input.mimeType || null,
            input.sizeBytes,
            effectiveStatus,
            now(),
            now(),
            input.createdBy || null
        );
    return Number(result.lastInsertRowid);
}

function ensureTag(slug: string) {
    const normalized = slugFromText(slug);
    const existing = sqlite.prepare("select id from tags where slug = ?").get(normalized) as { id: number } | undefined;
    if (existing) return existing.id;
    const result = sqlite
        .prepare(`
            insert into tags (label, slug, created_at)
            values (?, ?, ?)
        `)
        .run(normalized, normalized, now());
    return Number(result.lastInsertRowid);
}

function ensureCollection(name: string) {
    const baseSlug = slugFromText(name);
    const existing = sqlite.prepare("select id from collections where slug = ?").get(baseSlug) as { id: number } | undefined;
    if (existing) return existing.id;
    const slug = buildUniqueSlug(name);
    const result = sqlite
        .prepare(`
            insert into collections (title, slug, kind, created_at, updated_at)
            values (?, ?, 'collection', ?, ?)
        `)
        .run(name.trim(), slug, now(), now());
    return Number(result.lastInsertRowid);
}

function replaceAssetTags(assetId: number, tagSlugs: string[]) {
    sqlite.prepare("delete from media_tags where asset_id = ?").run(assetId);
    for (const slug of tagSlugs) {
        const tagId = ensureTag(slug);
        sqlite
            .prepare(`
                insert into media_tags (asset_id, tag_id, applied_at)
                values (?, ?, ?)
            `)
            .run(assetId, tagId, now());
    }
}

function replaceAssetCollections(assetId: number, collectionNames: string[]) {
    sqlite.prepare("delete from collection_assets where asset_id = ?").run(assetId);
    collectionNames.forEach((name, index) => {
        const collectionId = ensureCollection(name.trim());
        sqlite
            .prepare(`
                insert into collection_assets (collection_id, asset_id, position, added_at)
                values (?, ?, ?, ?)
            `)
            .run(collectionId, assetId, index, now());
    });
}

function replaceAssetLocations(assetId: number, locations: AssetLocationInput[]) {
    sqlite.prepare("delete from asset_locations where asset_id = ?").run(assetId);
    for (const location of locations) {
        sqlite
            .prepare(`
                insert into asset_locations (
                    asset_id,
                    content_type,
                    label,
                    raw_address,
                    formatted_address,
                    google_place_id,
                    lat,
                    lng,
                    is_primary,
                    source,
                    source_ref,
                    status,
                    raw_response_json,
                    created_at,
                    updated_at
                )
                values (?, 'media', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `)
            .run(
                assetId,
                location.label || null,
                location.rawAddress || null,
                location.formattedAddress || null,
                location.googlePlaceId || null,
                location.lat ?? null,
                location.lng ?? null,
                location.isPrimary ? 1 : 0,
                location.source || "manual",
                location.sourceRef || null,
                location.status || "pending",
                location.rawResponseJson || null,
                now(),
                now()
            );
    }
}

export function saveImportedLocation(
    assetId: number,
    mediaType: AssetMatch["media_type"],
    location: AssetLocationInput
) {
    if (mediaType === "image") {
        sqlite.prepare("delete from asset_locations where asset_id = ?").run(assetId);
    } else if (location.isPrimary) {
        sqlite.prepare("update asset_locations set is_primary = 0 where asset_id = ?").run(assetId);
    }

    sqlite
        .prepare(`
            insert into asset_locations (
                asset_id,
                content_type,
                label,
                raw_address,
                formatted_address,
                google_place_id,
                lat,
                lng,
                is_primary,
                source,
                source_ref,
                status,
                raw_response_json,
                created_at,
                updated_at
            )
            values (?, 'media', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
            assetId,
            location.label || null,
            location.rawAddress || null,
            location.formattedAddress || null,
            location.googlePlaceId || null,
            location.lat ?? null,
            location.lng ?? null,
            location.isPrimary ? 1 : 0,
            location.source || "import",
            location.sourceRef || null,
            location.status || "pending",
            location.rawResponseJson || null,
            now(),
            now()
        );
}

export function updateMediaAsset(assetId: number, input: AssetUpdateInput) {
    const existing = getMediaAssetById(assetId);
    if (!existing) {
        throw new Error("Asset not found");
    }

    const title = input.title?.trim() || existing.title;
    sqlite
        .prepare(`
            update media_assets
            set title = ?,
                slug = ?,
                description = ?,
                visibility = ?,
                status = ?,
                updated_at = ?
            where id = ?
        `)
        .run(
            title,
            buildUniqueSlug(title, assetId),
            input.description ?? existing.description ?? null,
            input.visibility || existing.visibility,
            input.status || existing.status,
            now(),
            assetId
        );

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
