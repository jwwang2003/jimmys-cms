import { sql } from 'drizzle-orm';
import {
    integer,
    primaryKey,
    real,
    sqliteTable,
    text,
    uniqueIndex,
    index,
} from 'drizzle-orm/sqlite-core';

// export const locations = sqliteTable(
//     'locations',
//     {
//         id: integer('id').primaryKey(),
//         label: text('label').notNull(),
//         latitude: real('latitude').notNull(),
//         longitude: real('longitude').notNull(),
//         locality: text('locality'),
//         region: text('region'),
//         country: text('country'),
//         timezone: text('timezone'),
//         createdAt: integer('created_at', { mode: 'timestamp_ms' })
//             .notNull()
//             .default(sql`(unixepoch() * 1000)`),
//     },
//     (table) => [
//         uniqueIndex('locations_coordinates_idx').on(table.latitude, table.longitude),
//     ],
// );

// export const tags = sqliteTable(
//     'tags',
//     {
//         id: integer('id')
//             .primaryKey(),
//         label: text('label')
//             .notNull(),
//         slug: text('slug')
//             .notNull(),
//         description: text('description'),
//         color: text('color'),
//         createdAt: integer('created_at', { mode: 'timestamp_ms' })
//             .notNull()
//             .default(sql`(unixepoch() * 1000)`),
//     },
//     (table) => [uniqueIndex('tags_slug_idx').on(table.slug)],
// );

// export const mediaAssets = sqliteTable(
//     'media_assets',
//     {
//         id: integer('id').primaryKey(),
//         title: text('title').notNull(),
//         slug: text('slug').notNull(),
//         description: text('description'),
//         fileUrl: text('file_url').notNull(),
//         thumbnailUrl: text('thumbnail_url'),
//         mimeType: text('mime_type'),
//         sizeBytes: integer('size_bytes').notNull().default(0),
//         durationSeconds: integer('duration_seconds'),
//         width: integer('width'),
//         height: integer('height'),
//         status: text('status', {
//             enum: ['draft', 'scheduled', 'published', 'archived'],
//         })
//             .notNull()
//             .default('draft'),
//         visibility: text('visibility', {
//             enum: ['public', 'unlisted', 'private'],
//         })
//             .notNull()
//             .default('public'),
//         captureDate: integer('capture_date', { mode: 'timestamp_ms' }),
//         publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
//         createdAt: integer('created_at', { mode: 'timestamp_ms' })
//             .notNull()
//             .default(sql`(unixepoch() * 1000)`),
//         updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
//             .notNull()
//             .default(sql`(unixepoch() * 1000)`),
//         createdBy: integer('created_by')
//             .notNull()
//             .references(() => users.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
//         locationId: integer('location_id').references(() => locations.id, {
//             onDelete: 'set null',
//         }),
//     },
//     (table) => [
//         uniqueIndex('media_assets_slug_idx').on(table.slug),
//         index('media_assets_published_idx').on(table.publishedAt),
//     ],
// );

// export const mediaTags = sqliteTable(
//     'media_tags',
//     {
//         mediaId: integer('media_id')
//             .notNull()
//             .references(() => mediaAssets.id, { onDelete: 'cascade' }),
//         tagId: integer('tag_id')
//             .notNull()
//             .references(() => tags.id, { onDelete: 'cascade' }),
//         appliedAt: integer('applied_at', { mode: 'timestamp_ms' })
//             .notNull()
//             .default(sql`(unixepoch() * 1000)`),
//     },
//     (table) => [
//         primaryKey({ columns: [table.mediaId, table.tagId], name: 'media_tags_pk' }),
//     ],
// );
