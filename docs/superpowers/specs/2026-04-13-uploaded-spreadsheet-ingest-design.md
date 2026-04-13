# Uploaded Spreadsheet Ingest Design

## Goal

Replace the admin spreadsheet picker that reads from the local `data/` folder with direct spreadsheet upload in both spreadsheet-driven ingest flows:

- metadata-only import
- batch ingest of media files plus spreadsheet metadata

Keep the user workflow minimal while preserving a versioned parser boundary for future spreadsheet formats.

## Scope

In scope:

- accept uploaded `.xlsx`, `.xls`, and `.csv` files in both admin forms
- default parsing to the latest supported spreadsheet format
- keep the current spreadsheet schema as `V1`
- preserve current `V1` behavior for shared artwork and photography sheets
- keep tolerant tag parsing and auto-create missing tags before tagging assets
- return clear validation errors for missing, empty, or unsupported spreadsheet uploads
- update tests to cover the upload-based workflow

Out of scope:

- user-visible manual format selection
- auto-detection UX
- persisted server-side spreadsheet library or upload history
- changing the batch filename convention

## Current State

The current implementation uses server-side file discovery from `data/`:

- [BatchIngestForm.tsx](/B:/projects/jimmys-cms/src/components/admin/BatchIngestForm.tsx) renders a `Select` from discovered spreadsheet filenames
- [SpreadsheetImportForm.tsx](/B:/projects/jimmys-cms/src/components/admin/SpreadsheetImportForm.tsx) does the same for metadata-only import
- [batch-import route](/B:/projects/jimmys-cms/src/app/api/admin/media/batch-import/route.ts) expects `spreadsheetFileName`
- [metadata-import route](/B:/projects/jimmys-cms/src/app/api/admin/media/metadata-import/route.ts) expects JSON with `fileName`
- [spreadsheet-files.ts](/B:/projects/jimmys-cms/src/lib/media/spreadsheet-files.ts) lists and reads spreadsheets from `data/`

This is operational but too rigid for the desired workflow because the operator already has the spreadsheet in hand when importing a batch.

## Proposed Design

### 1. UI workflow

Replace spreadsheet selection with direct file upload in both forms.

Metadata import:

- one spreadsheet file input
- no local file picker
- submit uploads the spreadsheet directly to the route

Batch ingest:

- one spreadsheet file input
- one multi-file media input
- submit uploads both the spreadsheet and media files in the same multipart request

The UI should describe the spreadsheet as the shared `V1` format used by artwork and photography imports, without exposing version controls.

### 2. Parser version boundary

Keep a versioned parser boundary in code, but default it internally to the latest supported version.

Implementation shape:

- `parseMetadataSpreadsheet(...)` remains the public entrypoint
- internally it dispatches to `parseMetadataSpreadsheetV1(...)`
- future versions can add `parseMetadataSpreadsheetV2(...)` without changing routes or forms

This keeps the current UX simple while making future schema upgrades additive instead of invasive.

### 3. Request contract changes

Metadata import route:

- move from JSON body with `fileName` to `multipart/form-data`
- require a `spreadsheet` file field

Batch ingest route:

- remove `spreadsheetFileName`
- require a `spreadsheet` file field and one or more `files` media fields

Validation:

- reject missing spreadsheet file
- reject empty spreadsheet file
- reject unsupported extension
- keep existing media-file validation for batch ingest

### 4. Data and behavior

No schema change is required for this feature.

Existing behavior to preserve:

- artwork and photography spreadsheets use the same `V1` parser
- `标签/风格` and related aliases map into canonical tags
- multiple tags may be separated by commas and other common spreadsheet delimiters
- tag values are trimmed
- existing tags are reused
- missing tags are inserted into the `tags` table before `media_tags` rows are created
- unmatched spreadsheet rows do not abort the whole import

### 5. Error handling

Errors should be explicit and non-destructive:

- unsupported spreadsheet type: `Unsupported spreadsheet file type`
- missing spreadsheet upload: `Missing spreadsheet file upload`
- empty spreadsheet upload: `Spreadsheet file is empty`
- malformed spreadsheet content: preserve parser error but wrap it with route-specific context

Batch ingest should continue its current tolerant behavior for unmatched rows and invalid media filenames, and it should still return a summary instead of failing the full batch for row-level mismatches.

### 6. Testing

Add or update tests to verify:

- metadata import route accepts uploaded spreadsheet file
- batch ingest route accepts uploaded spreadsheet plus media files
- the `data/` folder is no longer required for the admin upload path
- parser still handles current artwork and photography `V1` sheets
- tag creation and trimming behavior remains intact
- unsupported spreadsheet uploads fail cleanly

## Risks

- multipart handling differences between the two routes can drift if validation is duplicated
- removing the `data/`-folder path from UI without consolidating route validation can leave inconsistent errors
- future `V2` support will be harder if versioning is only implied and not isolated in parser code now

## Recommendation

Implement direct spreadsheet upload in both admin flows now and keep the parser version boundary internal with `V1` as the latest format. This removes unnecessary operator friction without adding format-selection UI that the current CMS does not need.
