import { sql } from "drizzle-orm";
import {
    index,
    integer,
    primaryKey,
    sqliteTable,
    text,
    uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { user as authUser } from "@/../auth-schema";

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
        objectUrl: text("object_url"), // pre-resolved URL (optional)
        thumbnailKey: text("thumbnail_key"),
        thumbnailUrl: text("thumbnail_url"),
        mimeType: text("mime_type"),
        sizeBytes: integer("size_bytes").default(0).notNull(),
        durationMs: integer("duration_ms"),
        width: integer("width"),
        height: integer("height"),
        checksum: text("checksum"),
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
        index("media_assets_published_idx").on(table.publishedAt),
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

export const collections = sqliteTable(
    "collections",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        title: text("title").notNull(),
        slug: text("slug").notNull(),
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
