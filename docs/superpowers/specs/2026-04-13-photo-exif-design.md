# Photo EXIF Extraction Design

## Goal

Add EXIF parsing for uploaded and normalized image assets so the CMS can extract structured photo metadata and reconcile EXIF GPS with spreadsheet-driven location data.

## Scope

In scope:

- parse EXIF from image uploads
- store normalized EXIF metadata in dedicated SQL tables
- deduplicate camera and lens records
- persist EXIF GPS as a source-aware asset location candidate
- detect conflicts between EXIF GPS and spreadsheet/manual location data
- default unresolved location conflicts to EXIF
- keep image upload successful even when EXIF parsing is missing or malformed

Out of scope:

- EXIF parsing for videos
- destructive replacement of spreadsheet locations
- automatic user prompts outside the CMS admin review workflow
- broad media AI analysis beyond EXIF

## Current State

The CMS currently stores:

- general asset fields in `media_assets`
- flexible key/value metadata in `media_attributes`
- source locations in `asset_locations`
- spreadsheet-origin metadata in `metadata_json`

There is no current EXIF extraction step in the image upload flow, and no dedicated relational model for camera, lens, or capture settings.

## Proposed Design

### 1. Extraction flow

Add EXIF extraction to the image ingestion path in `uploadMediaAsset(...)`.

Flow:

1. upload file to S3
2. classify as image/video/other
3. if image, parse EXIF from uploaded bytes
4. persist normalized asset row
5. persist EXIF row plus related camera/lens rows
6. if EXIF GPS exists, create or compare a location candidate
7. if spreadsheet/manual location already exists, detect whether it matches or conflicts

Malformed or missing EXIF should never abort upload. It should degrade to “no EXIF metadata extracted”.

### 2. Data model

Add the following tables:

- `photo_cameras`
  - deduplicated camera make/model records
- `photo_lenses`
  - deduplicated lens records
- `photo_exif`
  - one row per image asset containing extracted EXIF fields and foreign keys to camera/lens
- `asset_location_conflicts`
  - records mismatches between EXIF-derived and existing asset location sources

Keep `asset_locations` as the canonical location table. EXIF GPS becomes another location source, not a separate location system.

### 3. EXIF fields to store

Store at least:

- capture timestamp
- camera make
- camera model
- lens model
- focal length
- aperture
- shutter / exposure time
- ISO
- orientation
- pixel width
- pixel height
- GPS latitude
- GPS longitude
- GPS altitude
- software

Recommended split:

- general dimensions continue on `media_assets.width` and `media_assets.height`
- detailed capture metadata lives in `photo_exif`
- raw/auxiliary EXIF fragments may also be mirrored into `metadata_json.exif` for debugging

### 4. Location reconciliation

If EXIF GPS exists and an asset already has a location:

- compare by coordinates when both sources have them
- use a practical “same place” threshold, default 100 meters
- if spreadsheet/manual source lacks coordinates, compare after geocoding when available

Outcomes:

- same place:
  - keep canonical location without raising a conflict
  - store provenance that both EXIF and spreadsheet agree
- different place:
  - keep both location records
  - insert `asset_location_conflicts` row with status `pending`
  - effective default winner is EXIF if the user takes no action

Conflict rows should preserve:

- `asset_id`
- `existing_location_id`
- `candidate_location_id`
- `distance_meters`
- `resolution`
- `resolved_by`
- timestamps

### 5. Admin behavior

Conflicts should surface in the admin CMS as reviewable items, not blocking failures.

If the user resolves:

- keep EXIF
- keep existing location

If ignored:

- EXIF is treated as the effective winner

This matches the expected rule that embedded capture GPS is usually the more exact source for where the photo was taken.

### 6. Error handling

Rules:

- no EXIF block on upload
- EXIF parse errors become warnings, not hard failures
- no GPS in EXIF is normal and should not create warnings by itself
- conflict detection should be deterministic and auditable

### 7. Testing

Add tests for:

- image upload with EXIF metadata
- image upload without EXIF metadata
- EXIF GPS creating a location candidate
- spreadsheet and EXIF locations matching
- spreadsheet and EXIF locations conflicting
- unresolved conflict defaulting to EXIF
- startup migrations creating the new EXIF tables

## Recommendation

Implement EXIF as a structured image-ingest subsystem with dedicated SQL tables and explicit location conflict tracking. This keeps the CMS queryable and auditable while preserving both spreadsheet and embedded capture metadata.
