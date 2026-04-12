# Media-First CMS Design

**Date:** 2026-04-12

## Goal

Build a simple CMS on top of the current Next.js project for managing images and videos first, with articles supported later. The CMS should keep binaries in S3, keep metadata in SQLite via Drizzle, tolerate messy pre-existing S3 data, and support tags, albums, collections, and geolocation.

## Current Project State

The current repository already contains the right foundation for a media-first CMS, but most of the CMS layer is still missing.

- Next.js App Router with Mantine UI is in place.
- Better Auth and protected `/admin` routes are wired.
- SQLite + Drizzle are configured.
- A dev-only S3 browser exists for listing, uploading, renaming, deleting, and previewing S3 objects.
- The media schema already defines `storage_locations`, `storage_folders`, `media_assets`, `storage_objects`, `media_renditions`, `tags`, `media_tags`, `media_attributes`, `collections`, and `collection_assets`.
- The admin UI is mostly placeholder or mock-data driven.
- The local SQLite file contains the media/auth tables, but they are empty.
- Local dependencies are not installed in this workspace at the moment.

## Product Scope

### In Scope For V1

- Manage images and videos.
- Support direct CMS uploads to S3.
- Support syncing pre-existing S3 data into the CMS.
- Keep sync and ingestion tolerant of messy S3 contents.
- Support tags.
- Support albums and collections.
- Support geolocation tied to assets.
- Provide a usable admin UI for browsing, editing, and reviewing assets.

### Deferred

- Rich article authoring and publishing.
- Advanced derived renditions/transcoding workflows.
- Public-facing media delivery pages.
- Deep workflow states beyond draft/review/published/archive.
- Fine-grained RBAC beyond the current auth roles.

## Design Principles

- Keep the structure simple.
- Use explicit schema fields for primary features that need filtering or querying.
- Keep S3 as binary storage only; treat SQLite as the metadata source of truth.
- Do not let dirty S3 data break sync jobs or the admin UI.
- Reuse the existing schema direction where possible instead of replacing it.

## Recommended Architecture

- **Binary storage:** Amazon S3
- **Metadata storage:** SQLite via Drizzle
- **Canonical media record:** `media_assets`
- **Raw object inventory:** `storage_objects`
- **Admin UI:** Next.js App Router pages under `/admin`
- **Operational tools:** keep the existing `/dev/storage` flow for debugging and bucket inspection

Each media item should pass through the same normalization pipeline regardless of source:

1. File arrives through CMS upload or S3 sync.
2. Raw object is recorded in `storage_objects`.
3. Metadata is extracted on a best-effort basis.
4. Validation decides whether the object is valid, warning-only, or invalid.
5. Valid objects are linked or promoted into `media_assets`.
6. Warning/invalid objects remain visible for review without blocking the rest of the import.

## Core Content Model

### Media Assets

Keep `media_assets` as the canonical table for images and videos.

Use it for:

- title
- slug
- description
- media type
- object key and object URL
- dimensions and duration
- visibility
- publication status
- lightweight metadata JSON when needed

This remains the main editorial record.

### Raw S3 Objects

Keep `storage_objects` as the raw S3 inventory and sync table.

This table should be allowed to contain:

- objects that do not yet map to a media asset
- objects that are malformed or unsupported
- objects that were found during sync but still need manual review

This is the buffer that keeps messy S3 data from polluting the canonical editorial layer.

### Tags

Keep `tags` and `media_tags` as-is.

Tags are first-class because filtering by tag is an expected core CMS feature.

### Albums And Collections

Keep one grouping system and avoid separate tables for albums versus collections.

Recommended change:

- add `kind` to `collections`
- allowed values: `album | collection`

Meaning:

- `album` = ordered grouping mainly for media sets
- `collection` = broader curated grouping that may later mix videos, images, and articles

This keeps the data model simple while preserving the user-facing distinction.

### Articles

Do not include article authoring in the first implementation milestone.

When added later, keep it minimal:

- one `articles` table
- `title`, `slug`, `summary`, `body_json`, `status`, `hero_asset_id`, timestamps

Tiptap is already present in dependencies, so storing editor JSON is the simplest future path.

## Geolocation Model

Geolocation should not be hidden inside `metadataJson` because it needs reliable querying, map rendering, and import auditing.

Add a new `asset_locations` table.

Recommended fields:

- `id`
- `asset_id`
- `content_type`
- `label`
- `raw_address`
- `formatted_address`
- `google_place_id`
- `lat`
- `lng`
- `is_primary`
- `source`
- `source_ref`
- `status`
- `raw_response_json`
- timestamps

### Location Rules

- Images: exactly one primary location.
- Videos: zero or more locations, with at most one primary location.
- Articles later: same multi-location rule as videos.
- Always preserve the imported raw address even when geocoding fails.
- Store normalized coordinates separately from the raw Google response.

## Ingestion And Failure Handling

The system should support both direct uploads and S3 sync from day one.

### Shared Ingestion Service

Build one server-side ingestion service used by:

- CMS upload flow
- S3 sync flow
- future external import hooks

This service should normalize, validate, and persist media consistently no matter how the file arrived.

### Upload Flow

1. Admin uploads a file through the CMS.
2. Server writes the binary to S3.
3. Server extracts basic metadata.
4. Server records or updates the raw object in `storage_objects`.
5. Server creates or updates the canonical `media_assets` row if the object is valid enough.
6. Non-blocking issues are recorded as warnings.

Hard failure should be reserved for real blockers such as:

- S3 write failure
- unreadable request body
- malformed upload payload

### Sync Flow

1. Admin starts a sync for a bucket and prefix.
2. System lists S3 objects and records them in `storage_objects`.
3. Each object is normalized and classified.
4. Valid objects create or update `media_assets`.
5. Warning/invalid objects stay in `storage_objects` and are surfaced in review UI.
6. The sync continues even when some objects are bad.

### Classification

Recommended classification outcomes:

- `valid`
- `warning`
- `invalid`

Recommended sync tracking on `storage_objects`:

- `discovered`
- `normalized`
- `warning`
- `invalid`

Recommended `warning` examples:

- unsupported but recognizable MIME type
- missing dimensions
- missing duration
- duplicate checksum
- unexpected key format

Recommended `invalid` examples:

- unreadable object metadata
- missing stable object key
- completely unsupported media type for V1

### Validation Rules For V1

- Only images and videos become canonical media assets.
- A stable `storage_id + object_key` identity is required.
- MIME type should be inferred from S3 metadata or filename.
- Duplicate detection should prefer `storage_id + object_key`, then checksum when available.
- Width, height, and duration extraction should be best-effort rather than universal blockers.

## Geo Import Workflow

The CMS should support your external location pipeline without forcing the external system to change how it stores source data.

Recommended flow:

1. External process produces a normalized payload derived from the Excel source.
2. CMS import receives rows containing asset identifier plus address data.
3. Import process matches rows to media assets.
4. Address is geocoded through Google Maps API.
5. Normalized location fields are written to `asset_locations`.
6. Failures become review items instead of aborting the whole import.

### Matching

For V1, keep matching conservative:

- match by internal asset ID when available
- otherwise match by stable object key or other canonical external reference

Do not rely on fuzzy title matching.

## Admin UI

### `/admin`

Replace the placeholder dashboard with a real overview showing:

- total assets
- items in review
- warning items
- invalid sync objects
- assets missing location
- published versus draft counts

### `/admin/media`

This should be the main asset management screen.

Recommended features:

- grid or table browsing
- filters for media type, status, visibility, tags, collection/album, and location state
- search by title, slug, or object key
- quick indicators for warnings and missing location

### `/admin/media/[id]`

Asset detail/edit view should support:

- title
- slug
- description
- tags
- album/collection membership
- visibility
- publication status
- location editing
- warning review

### `/admin/media/sync`

Operational media screen for:

- running S3 sync
- reviewing sync warnings
- reviewing invalid objects
- reviewing import results

### Dev Storage Tool

Keep `/dev/storage` as a development and operations tool only. It should not become the editorial CMS UI.

## What Is Missing In The Current Repo

The current repo has foundation but not the actual CMS behavior.

Missing pieces:

- no media ingestion service
- no DB-backed media admin pages
- no CRUD APIs for media metadata
- no use of `tags`, `collections`, or `media_attributes` in app flows
- no location model
- no Google Maps integration
- no import flow for address data
- no review queue for bad sync results
- no real admin dashboard
- no article model yet

## Phased Implementation Plan

### Phase 1: Foundation

- install dependencies and verify local boot
- add migrations for schema refinements
- seed `storage_locations` and `storage_folders`
- define stable key conventions and sync rules

### Phase 2: Media Ingestion

- build shared ingestion service
- connect CMS uploads to S3 plus metadata persistence
- connect S3 sync to `storage_objects` plus `media_assets`
- add tolerant warning/invalid handling

### Phase 3: Core CMS UI

- build real `/admin` dashboard
- build `/admin/media`
- build `/admin/media/[id]`
- build `/admin/media/sync`

### Phase 4: Geolocation

- add `asset_locations`
- integrate Google geocoding
- build location import flow
- add filters for missing/failed geocoding

### Phase 5: Optional Article Support

- add minimal `articles` table
- add article editor with stored JSON content
- allow collections to include article content if needed

## Recommended First Deliverable

The first usable milestone should provide:

- image and video upload from the CMS
- S3 sync for existing bucket data
- canonical media records in SQLite
- warning-safe handling for messy bucket contents
- tags
- album/collection membership
- one primary location on images
- multi-location support for videos
- a working `/admin/media` workflow

This is enough to become a real image/video CMS without overbuilding article support too early.
