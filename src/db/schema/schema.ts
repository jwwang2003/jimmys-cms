import { sql } from "drizzle-orm";
import {
    check,
    index,
    integer,
    primaryKey,
    real,
    sqliteTable,
    text,
    uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { user as authUser } from "../../../auth-schema";

const timestamp = () => sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const storageLocations = sqliteTable(
    "storage_locations",
    {
        id: text("id").primaryKey(), // friendly alias (e.g., "content", "media")
        bucketName: text("bucket_name").notNull(),
        region: text("region").notNull(),
        baseUrl: text("base_url"), // e.g., https://cdn.example.com/content
        createdAt: integer("created_at", { mode: "timestamp_ms" })
            .default(timestamp())
            .notNull(),
        updatedAt: integer("updated_at", { mode: "timestamp_ms" })
            .default(timestamp())
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [uniqueIndex("storage_locations_bucket").on(table.bucketName)]
);

export const storageFolders = sqliteTable(
    "storage_folders",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        storageId: text("storage_id")
            .notNull()
            .references(() => storageLocations.id, { onDelete: "cascade" }),
        folderType: text("folder_type", {
            enum: ["images", "videos", "gifs", "misc"],
        }).notNull(),
        prefix: text("prefix").notNull(), // e.g., content/, media/videos/
        description: text("description"),
        createdAt: integer("created_at", { mode: "timestamp_ms" })
            .default(timestamp())
            .notNull(),
        updatedAt: integer("updated_at", { mode: "timestamp_ms" })
            .default(timestamp())
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [
        uniqueIndex("storage_folders_type_unique").on(table.storageId, table.folderType),
        uniqueIndex("storage_folders_prefix_unique").on(table.storageId, table.prefix),
    ]
);

export const mediaAssets = sqliteTable(
    "media_assets",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        title: text("title").notNull(),
        slug: text("slug").notNull(),
        description: text("description"),
        mediaType: text("media_type", {
            enum: ["image", "video", "audio", "document", "other"],
        })
            .default("image")
            .notNull(),
        storageId: text("storage_id")
            .notNull()
            .references(() => storageLocations.id, { onDelete: "restrict" }),
        folderId: integer("folder_id").references(() => storageFolders.id, { onDelete: "set null" }),
        objectKey: text("object_key").notNull(), // S3 key
        filename: text("original_filename"),
        objectUrl: text("object_url"), // pre-resolved URL (optional)
        thumbnailKey: text("thumbnail_key"),
        thumbnailUrl: text("thumbnail_url"),
        mimeType: text("mime_type"),
        sizeBytes: integer("size_bytes").default(0).notNull(),
        durationMs: integer("duration_ms"),
        width: integer("width"),
        height: integer("height"),
        checksum: text("checksum"),
        // Materialised geography. The map facets on these on every page, and
        // media_attributes (EAV) is the wrong shape for a query that hot: it
        // costs a join and a row-per-attribute scan where a column costs an
        // index seek. Derived from geocoding, not authored directly.
        countryCode: text("country_code"),
        regionCode: text("region_code"),
        // Hash of the asset's semantic fields. An artifact is stale exactly
        // when one of its contributing hashes changed, which is what lets the
        // publish step diff instead of rewriting everything.
        contentHash: text("content_hash"),
        status: text("status", {
            enum: ["draft", "review", "published", "archived"],
        })
            .default("draft")
            .notNull(),
        visibility: text("visibility", {
            enum: ["private", "internal", "public"],
        })
            .default("private")
            .notNull(),
        lifecycleStatus: text("lifecycle_status", {
            enum: ["active", "trashed"],
        })
            .default("active")
            .notNull(),
        integrityStatus: text("integrity_status", {
            enum: ["ok", "missing", "warning", "invalid"],
        })
            .default("ok")
            .notNull(),
        integrityMessage: text("integrity_message"),
        lastVerifiedAt: integer("last_verified_at", { mode: "timestamp_ms" }),
        trashedAt: integer("trashed_at", { mode: "timestamp_ms" }),
        publishedAt: integer("published_at", { mode: "timestamp_ms" }),
        createdAt: integer("created_at", { mode: "timestamp_ms" })
            .default(timestamp())
            .notNull(),
        updatedAt: integer("updated_at", { mode: "timestamp_ms" })
            .default(timestamp())
            .$onUpdate(() => new Date())
            .notNull(),
        createdBy: text("created_by").references(() => authUser.id, { onDelete: "set null" }),
        metadataJson: text("metadata_json"), // arbitrary JSON metadata
    },
    (table) => [
        uniqueIndex("media_assets_slug_unique").on(table.slug),
        index("media_assets_storage_idx").on(table.storageId, table.objectKey),
        index("media_assets_status_idx").on(table.status),
        index("media_assets_lifecycle_idx").on(table.lifecycleStatus),
        index("media_assets_integrity_idx").on(table.integrityStatus),
        index("media_assets_published_idx").on(table.publishedAt),
        index("media_assets_country_idx").on(table.countryCode),
        index("media_assets_region_idx").on(table.regionCode),
        index("media_assets_content_hash_idx").on(table.contentHash),
        check(
            "media_assets_lifecycle_status_check",
            sql`${table.lifecycleStatus} in ('active', 'trashed')`
        ),
        check(
            "media_assets_integrity_status_check",
            sql`${table.integrityStatus} in ('ok', 'missing', 'warning', 'invalid')`
        ),
    ]
);

export const storageObjects = sqliteTable(
    "storage_objects",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        storageId: text("storage_id")
            .notNull()
            .references(() => storageLocations.id, { onDelete: "cascade" }),
        folderId: integer("folder_id").references(() => storageFolders.id, { onDelete: "set null" }),
        folderType: text("folder_type", {
            enum: ["images", "videos", "gifs", "misc"],
        }).notNull(),
        objectKey: text("object_key").notNull(),
        objectUrl: text("object_url"),
        mimeType: text("mime_type"),
        sizeBytes: integer("size_bytes").default(0).notNull(),
        checksum: text("checksum"),
        eTag: text("etag"),
        lastModified: integer("last_modified", { mode: "timestamp_ms" }),
        syncedAt: integer("synced_at", { mode: "timestamp_ms" })
            .default(timestamp())
            .notNull(),
        syncStatus: text("sync_status", {
            enum: ["discovered", "normalized", "warning", "invalid"],
        })
            .default("discovered")
            .notNull(),
        warningsJson: text("warnings_json").default("[]").notNull(),
        lastError: text("last_error"),
        assetId: integer("asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
        createdAt: integer("created_at", { mode: "timestamp_ms" })
            .default(timestamp())
            .notNull(),
    },
    (table) => [
        uniqueIndex("storage_objects_storage_key").on(table.storageId, table.objectKey),
        index("storage_objects_folder_idx").on(table.folderType),
    ]
);

export const mediaRenditions = sqliteTable(
    "media_renditions",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        assetId: integer("asset_id")
            .notNull()
            .references(() => mediaAssets.id, { onDelete: "cascade" }),
        label: text("label").notNull(), // e.g., "1080p", "thumb"
        objectKey: text("object_key").notNull(),
        objectUrl: text("object_url"),
        mimeType: text("mime_type"),
        width: integer("width"),
        height: integer("height"),
        sizeBytes: integer("size_bytes").default(0).notNull(),
        durationMs: integer("duration_ms"),
        createdAt: integer("created_at", { mode: "timestamp_ms" })
            .default(timestamp())
            .notNull(),
    },
    (table) => [uniqueIndex("media_renditions_asset_label").on(table.assetId, table.label)]
);

export const tags = sqliteTable(
    "tags",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        label: text("label").notNull(),
        slug: text("slug").notNull(),
        color: text("color"),
        description: text("description"),
        createdAt: integer("created_at", { mode: "timestamp_ms" })
            .default(timestamp())
            .notNull(),
    },
    (table) => [uniqueIndex("tags_slug_unique").on(table.slug)]
);

export const mediaTags = sqliteTable(
    "media_tags",
    {
        assetId: integer("asset_id")
            .notNull()
            .references(() => mediaAssets.id, { onDelete: "cascade" }),
        tagId: integer("tag_id")
            .notNull()
            .references(() => tags.id, { onDelete: "cascade" }),
        appliedAt: integer("applied_at", { mode: "timestamp_ms" })
            .default(timestamp())
            .notNull(),
    },
    (table) => [
        primaryKey({
            name: "media_tags_pk",
            columns: [table.assetId, table.tagId],
        }),
    ]
);

export const mediaAttributes = sqliteTable(
    "media_attributes",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        assetId: integer("asset_id")
            .notNull()
            .references(() => mediaAssets.id, { onDelete: "cascade" }),
        namespace: text("namespace").default("default").notNull(),
        key: text("key").notNull(),
        value: text("value").notNull(), // stored as string, interpret in app
        createdAt: integer("created_at", { mode: "timestamp_ms" })
            .default(timestamp())
            .notNull(),
        updatedAt: integer("updated_at", { mode: "timestamp_ms" })
            .default(timestamp())
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [
        uniqueIndex("media_attributes_unique_key").on(table.assetId, table.namespace, table.key),
    ]
);

export const photoCameras = sqliteTable(
    "photo_cameras",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        make: text("make"),
        model: text("model").notNull(),
        normalizedKey: text("normalized_key").notNull(),
        createdAt: integer("created_at", { mode: "timestamp_ms" })
            .default(timestamp())
            .notNull(),
    },
    (table) => [uniqueIndex("photo_cameras_normalized_key_unique").on(table.normalizedKey)]
);

export const photoLenses = sqliteTable(
    "photo_lenses",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        label: text("label").notNull(),
        normalizedKey: text("normalized_key").notNull(),
        createdAt: integer("created_at", { mode: "timestamp_ms" })
            .default(timestamp())
            .notNull(),
    },
    (table) => [uniqueIndex("photo_lenses_normalized_key_unique").on(table.normalizedKey)]
);

export const photoExif = sqliteTable(
    "photo_exif",
    {
        assetId: integer("asset_id")
            .primaryKey()
            .references(() => mediaAssets.id, { onDelete: "cascade" }),
        cameraId: integer("camera_id").references(() => photoCameras.id, { onDelete: "set null" }),
        lensId: integer("lens_id").references(() => photoLenses.id, { onDelete: "set null" }),
        capturedAt: integer("captured_at", { mode: "timestamp_ms" }),
        pixelWidth: integer("pixel_width"),
        pixelHeight: integer("pixel_height"),
        focalLengthMm: real("focal_length_mm"),
        apertureFNumber: real("aperture_f_number"),
        exposureTimeText: text("exposure_time_text"),
        iso: integer("iso"),
        orientation: integer("orientation"),
        software: text("software"),
        gpsLat: real("gps_lat"),
        gpsLng: real("gps_lng"),
        gpsAltitudeM: real("gps_altitude_m"),
        metadataJson: text("metadata_json"),
        createdAt: integer("created_at", { mode: "timestamp_ms" })
            .default(timestamp())
            .notNull(),
        updatedAt: integer("updated_at", { mode: "timestamp_ms" })
            .default(timestamp())
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [
        index("photo_exif_camera_idx").on(table.cameraId),
        index("photo_exif_lens_idx").on(table.lensId),
    ]
);

export const collections = sqliteTable(
    "collections",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        title: text("title").notNull(),
        slug: text("slug").notNull(),
        kind: text("kind", { enum: ["album", "collection"] })
            .default("collection")
            .notNull(),
        description: text("description"),
        coverAssetId: integer("cover_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
        createdAt: integer("created_at", { mode: "timestamp_ms" })
            .default(timestamp())
            .notNull(),
        updatedAt: integer("updated_at", { mode: "timestamp_ms" })
            .default(timestamp())
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [uniqueIndex("collections_slug_unique").on(table.slug)]
);

export const assetLocations = sqliteTable(
    "asset_locations",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        assetId: integer("asset_id")
            .notNull()
            .references(() => mediaAssets.id, { onDelete: "cascade" }),
        contentType: text("content_type", { enum: ["media", "article"] })
            .default("media")
            .notNull(),
        label: text("label"),
        rawAddress: text("raw_address"),
        formattedAddress: text("formatted_address"),
        googlePlaceId: text("google_place_id"),
        lat: real("lat"),
        lng: real("lng"),
        isPrimary: integer("is_primary", { mode: "boolean" }).default(false).notNull(),
        source: text("source").default("manual").notNull(),
        sourceRef: text("source_ref"),
        status: text("status", {
            enum: ["pending", "matched", "geocoded", "failed"],
        })
            .default("pending")
            .notNull(),
        rawResponseJson: text("raw_response_json"),
        createdAt: integer("created_at", { mode: "timestamp_ms" })
            .default(timestamp())
            .notNull(),
        updatedAt: integer("updated_at", { mode: "timestamp_ms" })
            .default(timestamp())
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [
        index("asset_locations_asset_idx").on(table.assetId),
        index("asset_locations_primary_idx").on(table.assetId, table.isPrimary),
    ]
);

export const assetLocationConflicts = sqliteTable(
    "asset_location_conflicts",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        assetId: integer("asset_id")
            .notNull()
            .references(() => mediaAssets.id, { onDelete: "cascade" }),
        existingLocationId: integer("existing_location_id").references(() => assetLocations.id, { onDelete: "set null" }),
        candidateLocationId: integer("candidate_location_id").references(() => assetLocations.id, { onDelete: "set null" }),
        distanceMeters: real("distance_meters"),
        status: text("status", { enum: ["pending", "resolved"] })
            .default("pending")
            .notNull(),
        resolution: text("resolution", { enum: ["keep_exif", "keep_existing"] }),
        resolvedBy: text("resolved_by").references(() => authUser.id, { onDelete: "set null" }),
        resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
        createdAt: integer("created_at", { mode: "timestamp_ms" })
            .default(timestamp())
            .notNull(),
        updatedAt: integer("updated_at", { mode: "timestamp_ms" })
            .default(timestamp())
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [
        index("asset_location_conflicts_asset_idx").on(table.assetId),
        index("asset_location_conflicts_status_idx").on(table.status),
    ]
);

export const mediaIngestJobs = sqliteTable(
    "media_ingest_jobs",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        status: text("status", {
            enum: ["queued", "running", "completed", "failed", "canceled"],
        })
            .default("queued")
            .notNull(),
        mode: text("mode").default("batch_upload").notNull(),
        spreadsheetFilename: text("spreadsheet_filename"),
        totalItems: integer("total_items").default(0).notNull(),
        processedItems: integer("processed_items").default(0).notNull(),
        completedItems: integer("completed_items").default(0).notNull(),
        warningItems: integer("warning_items").default(0).notNull(),
        failedItems: integer("failed_items").default(0).notNull(),
        unmatchedRows: integer("unmatched_rows").default(0).notNull(),
        currentItemLabel: text("current_item_label"),
        summaryJson: text("summary_json"),
        errorMessage: text("error_message"),
        createdBy: text("created_by").references(() => authUser.id, { onDelete: "set null" }),
        startedAt: integer("started_at", { mode: "timestamp_ms" }),
        finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
        createdAt: integer("created_at", { mode: "timestamp_ms" })
            .default(timestamp())
            .notNull(),
        updatedAt: integer("updated_at", { mode: "timestamp_ms" })
            .default(timestamp())
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [
        index("media_ingest_jobs_status_idx").on(table.status),
        index("media_ingest_jobs_created_by_idx").on(table.createdBy),
    ]
);

export const mediaIngestJobItems = sqliteTable(
    "media_ingest_job_items",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        jobId: integer("job_id")
            .notNull()
            .references(() => mediaIngestJobs.id, { onDelete: "cascade" }),
        orderIndex: integer("order_index").default(0).notNull(),
        originalFilename: text("original_filename").notNull(),
        storedObjectKey: text("stored_object_key"),
        externalId: text("external_id"),
        detectedMediaType: text("detected_media_type"),
        status: text("status", {
            enum: [
                "queued",
                "parsing",
                "matching",
                "uploading",
                "uploaded",
                "metadata_applied",
                "warning",
                "failed",
                "completed",
            ],
        })
            .default("queued")
            .notNull(),
        progressPercent: integer("progress_percent").default(0).notNull(),
        assetId: integer("asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
        warningMessage: text("warning_message"),
        errorMessage: text("error_message"),
        detailJson: text("detail_json"),
        createdAt: integer("created_at", { mode: "timestamp_ms" })
            .default(timestamp())
            .notNull(),
        updatedAt: integer("updated_at", { mode: "timestamp_ms" })
            .default(timestamp())
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [
        index("media_ingest_job_items_job_idx").on(table.jobId, table.orderIndex),
        index("media_ingest_job_items_status_idx").on(table.status),
    ]
);

export const collectionAssets = sqliteTable(
    "collection_assets",
    {
        collectionId: integer("collection_id")
            .notNull()
            .references(() => collections.id, { onDelete: "cascade" }),
        assetId: integer("asset_id")
            .notNull()
            .references(() => mediaAssets.id, { onDelete: "cascade" }),
        position: integer("position").default(0).notNull(),
        addedAt: integer("added_at", { mode: "timestamp_ms" })
            .default(timestamp())
            .notNull(),
    },
    (table) => [
        primaryKey({
            name: "collection_assets_pk",
            columns: [table.collectionId, table.assetId],
        }),
        index("collection_assets_position_idx").on(table.collectionId, table.position),
    ]
);

/**
 * Build ledger: which artifact, at which content hash, currently lives at which
 * object key (cms-plan.md §6).
 *
 * The artifact hash is sha256(GENERATOR_VERSION ‖ sorted contributing
 * content_hashes) and carries no timestamp, because an artifact is stale
 * exactly when its inputs changed — not when time passed. Publishing recomputes
 * the hash, compares it against this row, and writes only on a mismatch.
 */
export const buildState = sqliteTable(
    "build_state",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        /** Logical artifact name, e.g. "catalog" or "manifest". */
        artifact: text("artifact").notNull(),
        /** sha256 over the generator version and the contributing hashes. */
        artifactHash: text("artifact_hash").notNull(),
        /** Generator version the hash was computed under. */
        generatorVersion: text("generator_version").notNull(),
        /** Where the artifact was written. Content-hashed for everything but the manifest. */
        objectKey: text("object_key").notNull(),
        objectUrl: text("object_url"),
        sizeBytes: integer("size_bytes").default(0).notNull(),
        /** How many assets contributed, kept for reporting rather than correctness. */
        itemCount: integer("item_count").default(0).notNull(),
        builtAt: integer("built_at", { mode: "timestamp_ms" })
            .default(timestamp())
            .notNull(),
    },
    (table) => [
        // One current row per artifact; history is the object store's job, not
        // this table's.
        uniqueIndex("build_state_artifact_unique").on(table.artifact),
        index("build_state_hash_idx").on(table.artifactHash),
    ]
);
