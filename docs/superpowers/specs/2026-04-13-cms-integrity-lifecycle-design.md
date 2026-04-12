# CMS Integrity And Lifecycle Design

**Date:** 2026-04-13

## Goal

Make the CMS operationally robust after upload and ingest by adding:

- file integrity checks against S3
- clear missing-file warnings instead of silent drift
- real asset lifecycle controls
- fast CRUD-style admin actions for assets

This design extends the existing media-first CMS instead of replacing it.

## Problem Statement

The CMS can currently upload, sync, and ingest media, but it is still weak as a day-to-day admin tool.

Current gaps:

- an asset can remain locally valid even after its S3 object is deleted
- there is no explicit integrity verification workflow
- assets do not have a dedicated soft-delete lifecycle
- there is no recycle-bin workflow
- admin controls are still biased toward creation rather than maintenance

The result is that the system can ingest content but cannot reliably signal when the underlying file is gone, and it cannot manage the full content lifecycle cleanly.

## Design Principles

- Keep missing files visible in admin
- Treat missing files as warnings, not hidden failures
- Separate editorial status from lifecycle status from file integrity status
- Prefer soft delete by default
- Reserve permanent delete for explicit recycle-bin actions
- Keep S3 failures and missing objects operationally reviewable
- Reuse the current `media_assets` model instead of creating a second asset abstraction

## Recommended Model

Keep one canonical asset record in `media_assets`, but track three independent concerns.

### Editorial Status

Use the existing field:

- `draft`
- `review`
- `published`
- `archived`

This answers: what is the editorial state of the content?

### Lifecycle Status

Add a new field:

- `active`
- `trashed`

This answers: is the record live in the library or in the recycle bin?

### Integrity Status

Add a new field:

- `ok`
- `missing`
- `warning`
- `invalid`

This answers: does the underlying file look healthy and available?

## Schema Changes

Add the following fields to `media_assets`:

- `lifecycle_status`
- `integrity_status`
- `integrity_message`
- `last_verified_at`
- `trashed_at`

Recommended defaults:

- `lifecycle_status = active`
- `integrity_status = ok` for direct uploads

Recommended meanings:

- `ok`: object was verified or is confidently present
- `missing`: object does not exist in S3
- `warning`: verification hit a non-fatal operational issue
- `invalid`: asset record is malformed or cannot be meaningfully checked

## Integrity Check Behavior

### Single Asset Verify

For one asset:

1. Read `storage_id` and `object_key`
2. Resolve the S3 bucket from storage config
3. Run `HeadObject`
4. Update integrity fields

Outcomes:

- object exists: `integrity_status = ok`
- object not found: `integrity_status = missing`
- malformed storage metadata: `integrity_status = invalid`
- transient AWS/network error: `integrity_status = warning`

Store a concise human-readable message in `integrity_message`.

Examples:

- `Object not found in S3`
- `Missing storage mapping`
- `AWS timeout while verifying object`

### Bulk Verify

Bulk verification should:

- run in batches
- continue even if some assets fail
- update `last_verified_at` for every attempted asset
- return a summary count for `ok`, `missing`, `warning`, and `invalid`

This should behave like the tolerant S3 sync pipeline:

- do not abort the whole run because one asset is bad
- preserve reviewability

### Important Rule

Missing-file assets remain visible in admin.

They are not hidden and not auto-deleted.

They should instead become obvious warning items that can be:

- restored by re-upload
- archived
- moved to trash
- permanently deleted

## Lifecycle Behavior

### Archive

Archive is editorial, not deletion.

Effects:

- set editorial status to `archived`
- keep lifecycle as `active`
- keep file references intact

### Move To Trash

Trash is soft delete.

Effects:

- set `lifecycle_status = trashed`
- set `trashed_at`
- keep related tags, collections, locations, and metadata
- keep the record recoverable

### Restore From Trash

Effects:

- set `lifecycle_status = active`
- clear `trashed_at`

### Permanent Delete

Permanent delete is only available as an explicit action from the recycle-bin workflow.

Effects:

- remove the asset row
- cascade related metadata that depends on the asset
- optionally delete the S3 object only if explicitly requested

Important:

- the default permanent-delete action should remove the CMS record
- deletion of the binary from S3 should remain explicit and separate

This avoids accidental destruction of source files.

## Admin Actions

Add fast asset actions:

- `Verify File`
- `Archive`
- `Restore`
- `Move to Trash`
- `Restore from Trash`
- `Permanent Delete`

These actions should be accessible from:

- the media table
- the asset detail page
- the recycle-bin view where relevant

Bulk actions should include:

- bulk verify
- bulk archive
- bulk move to trash
- bulk restore from trash

Permanent delete should stay explicit and not be part of casual bulk operations.

## Admin UI Changes

### Media Table

Extend `/admin/media` with:

- integrity badge
- lifecycle badge
- quick action buttons
- filters for `integrity_status`
- filters for `lifecycle_status`

Suggested listing behavior:

- active assets shown by default
- trashed assets hidden from the default library view
- missing-file assets still shown in the active library with a warning badge

### Asset Detail

Extend `/admin/media/[id]` with:

- integrity summary
- last verified timestamp
- verify-now action
- archive action
- trash action
- restore action when relevant
- permanent delete action only when trashed

### Recycle Bin

Add a recycle-bin style admin view, either:

- as a dedicated route, or
- as a strong table filter preset

Recommended behavior:

- list only `lifecycle_status = trashed`
- surface integrity status there too
- support restore and permanent delete

### Sync / Operations View

Extend the sync/admin operations area with an integrity panel:

- verify all active assets
- verify filtered assets
- show last verification summary
- show counts by integrity status

This keeps S3 sync and S3 integrity checks together operationally.

## CRUD Scope

The CMS should support practical asset CRUD, not just creation.

### Create

Already covered by:

- upload
- S3 sync
- batch ingest

### Read

Improve with:

- integrity-aware listing
- lifecycle-aware filtering
- recycle-bin view

### Update

Add easy update controls for:

- title
- description
- tags
- collections
- visibility
- editorial status
- lifecycle status
- integrity verification trigger

### Delete

Two-stage:

- soft delete to trash
- permanent delete from recycle bin

## Operational Semantics

### Uploads

Direct uploads can initialize `integrity_status = ok` because the write just succeeded.

Later integrity checks remain the source of truth if the file is changed or removed externally.

### S3 Sync

S3 sync can continue populating `storage_objects` and updating `media_assets`, but integrity verification becomes the explicit mechanism for checking whether already-cataloged assets still exist.

### External Mutations

If a user deletes or renames files directly in S3, the CMS should not pretend the asset is still healthy forever.

Integrity checks close that gap.

## Failure Handling

Do not mark everything as missing on generic AWS failures.

Rules:

- `404` or definite not-found means `missing`
- malformed local asset data means `invalid`
- network/AWS transient problems mean `warning`

This prevents false missing-file flags during outages or permission issues.

## Testing Requirements

Add regression coverage for:

- single-asset verify marks an object as missing
- bulk verify tolerates mixed results
- move to trash and restore behavior
- permanent delete removes the asset and related rows
- missing-file assets remain queryable in admin listings
- recycle-bin filtering excludes active assets

## Recommended First Implementation Slice

Implement in this order:

1. Drizzle schema changes for lifecycle and integrity fields
2. Repository/service methods for verify, trash, restore, archive, and permanent delete
3. Admin API routes for these actions
4. Media table action column and filter controls
5. Recycle-bin view or preset
6. Integrity panel in the sync/admin area

This delivers operational usefulness quickly without waiting on a larger redesign.

## Success Criteria

The CMS is considered improved when:

- deleting an S3 object can be detected by an integrity check
- the asset remains visible with a missing-file warning
- admins can verify one asset or many assets
- admins can trash, restore, archive, and permanently delete assets
- trashed assets are separated from active assets
- the UI supports asset maintenance, not just asset creation
