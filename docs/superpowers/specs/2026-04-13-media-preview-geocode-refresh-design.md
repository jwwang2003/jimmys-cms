# Media Preview And Geocode Refresh Design

## Goal

Add two operational capabilities to the CMS without creating a parallel workflow:

1. Let users preview stored media directly from the browser on the asset detail page.
2. Let editors trigger Google Maps geolocation refreshes both per asset and in bulk for spreadsheet/manual location rows.

The design keeps EXIF location handling intact and layers refresh controls into the existing admin media detail and sync pages.

## Scope

### In scope

- Image and video preview on the media detail page.
- Asset-level geocode refresh for the current asset.
- Bulk geocode refresh from the sync workspace.
- Reuse of existing Google Maps geocoding integration.
- Editor-only mutation actions with guest-safe read-only preview access.
- Summary and failure reporting for refresh actions.

### Out of scope

- Signed URL generation or private-object proxying.
- Map visualization or embedded map widgets.
- Bulk refresh for EXIF-derived locations.
- Automatic background re-geocoding.
- Article preview work.

## Current Context

- Asset detail already exists at `src/app/admin/media/[id]/page.tsx`.
- Bulk maintenance actions already live in `src/app/admin/media/sync/page.tsx`.
- Spreadsheet/manual geocoding already exists in `src/lib/media/spreadsheet-import.ts` and `src/lib/media/location-import.ts`.
- Media detail records already expose `object_url`, `media_type`, `locations`, `object_key`, and EXIF conflict information through the media service and repository layer.

This makes the lowest-risk path an extension of existing pages and services rather than a new tool surface.

## Recommended Approach

Add preview and refresh controls to the existing admin flow:

- Asset detail page becomes the place to inspect and preview a single asset.
- Sync page remains the place for bulk maintenance operations.
- A shared service layer performs single-asset and bulk location refresh work using the current Google Maps geocoder.

This approach minimizes navigation churn, keeps operational actions near related information, and avoids duplicating media/location logic.

## UX Design

### Asset Detail Page

Add a preview card above or beside the existing asset editor.

Behavior:

- For `image` assets, render the `object_url` with an image preview.
- For `video` assets, render a native `<video controls>` preview using the same URL.
- For unsupported or missing preview URLs, show a fallback state with:
  - object key
  - media type
  - direct link if `object_url` exists
  - message when preview is unavailable

Add a location card in the same page with:

- primary location label/address/status
- current coordinates if present
- source (`spreadsheet`, `manual`, `exif`, etc.)
- `Refresh geolocation` button for editable users only

Guests can see preview and location information but cannot trigger refresh actions.

### Sync Page

Add a new maintenance panel near integrity/exif conflict tools.

Panel actions:

- `Refresh pending geocodes`
  - targets spreadsheet/manual rows with status `pending` or `failed`
- optional secondary action: `Force refresh all spreadsheet geocodes`
  - targets spreadsheet/manual rows including rows already marked `geocoded`

To keep the default simple and safe, the primary button will only refresh `pending` and `failed`.

Panel output:

- checked row count
- geocoded count
- failed count
- skipped count
- whether Google Maps API key is available

## Data Rules

### Refresh targets

Asset-level refresh:

- Prefer the asset's primary non-EXIF location row.
- If there is no primary non-EXIF row, fall back to the first non-EXIF row with a raw or formatted address.
- If no refreshable row exists, return a clean validation result instead of throwing.

Bulk refresh:

- Target only rows whose `source` is not `exif`.
- Default filter is `status in ('pending', 'failed')`.
- Forced refresh may include `geocoded` rows but still excludes `exif`.

### Address selection

Refresh uses the best available address text in this order:

1. `raw_address`
2. `formatted_address`
3. synthesized label/city/country if present

If no usable address text exists, the row is counted as skipped.

### Write behavior

Successful refresh updates the existing location row in place:

- `formatted_address`
- `google_place_id`
- `lat`
- `lng`
- `status = 'geocoded'`
- `raw_response_json`
- `updated_at`

Failed geocode updates:

- `status = 'failed'`
- `updated_at`

Refresh does not change:

- `source`
- `source_ref`
- `is_primary` directly unless existing EXIF reconciliation logic requires it

### EXIF interaction

Refreshing spreadsheet/manual rows must not bypass EXIF conflict logic.

For image assets:

- after updating a non-EXIF location row, run the existing EXIF reconciliation path
- if EXIF and refreshed location disagree beyond the configured threshold, preserve the current conflict workflow

For video assets:

- update the location row without EXIF reconciliation

## API Design

### Asset-level action

Extend `src/app/api/admin/media/[id]/route.ts` with a mutation action or add a dedicated action branch that supports:

- `action = "refreshGeocode"`

Response shape:

- `ok`
- refreshed asset detail payload
- summary:
  - `updated`
  - `failed`
  - `skipped`
  - `message`

Error behavior:

- `401` unauthenticated
- `403` guest/read-only user
- `400` no refreshable location or missing address
- `409` optional if conflict resolution state blocks refresh
- `500` only for unexpected server failures

### Bulk action

Extend `src/app/api/admin/media/actions/route.ts` with:

- `action = "refreshManyGeocodes"`
- optional `mode = "pending"` or `mode = "force"`

Response shape:

- `ok`
- summary:
  - `checked`
  - `geocoded`
  - `failed`
  - `skipped`
  - `googleMapsEnabled`

If the Google key is missing, return a non-crashing response with a clear message and zero updated rows.

## Service Design

Add service-layer helpers in `src/lib/media/service.ts`:

- `refreshMediaAssetGeolocation(assetId)`
- `refreshManyMediaAssetGeolocations(options)`

Responsibilities:

- validate refresh eligibility
- invoke Google Maps geocoder
- update repository rows
- invoke EXIF reconciliation where required
- produce response summaries for UI/API layers

The service should be the only layer that knows how to combine repository updates with Google Maps calls and EXIF follow-up.

## Repository Design

Add repository helpers in `src/lib/media/repository.ts` for:

- selecting refreshable location candidates for one asset
- selecting bulk refresh candidates by source/status
- updating a location row from a fresh geocode result
- marking a location row as failed or skipped

Repository work remains on Drizzle ORM APIs.

## Preview Design

Preview is read-only and should not introduce a new fetch API if the current asset detail already has enough data.

Preferred rendering:

- asset detail server page passes current asset data into the editor page
- preview component consumes `media_type`, `object_url`, `object_key`, and title

Fallback behavior:

- if `object_url` is null, show an unavailable state
- if the asset is marked `missing` by integrity checks, surface a warning above preview

No extra storage or DB changes are required for preview.

## Error Handling

### Preview

- Missing `object_url`: show fallback card, not an exception.
- Browser load failure: render broken-preview messaging and direct link text.

### Geocode refresh

- Missing Google API key: show a clear no-op result.
- Missing refreshable address: mark as skipped.
- Google no-match: mark as failed.
- Google request error: mark as failed and include summary message.
- Asset not found: standard `404`.

Bulk refresh should continue across rows even when some rows fail.

## Testing

Add tests for:

- asset preview card renders image/video/fallback states
- asset-level refresh updates a spreadsheet/manual location row
- asset-level refresh is rejected for guests
- asset-level refresh is a clean skip when no non-EXIF address exists
- bulk refresh updates pending/failed spreadsheet/manual rows
- bulk refresh skips EXIF rows
- missing Google key returns a non-500 response and zero updates
- image refresh still triggers EXIF conflict reconciliation logic when needed

## Risks

### Object URL assumptions

Current preview depends on `object_url` being browser-usable. If some objects require signed URLs later, preview can be moved behind a dedicated proxy route without changing the page-level UX.

### Bulk refresh cost

Bulk geocoding can consume API quota. Defaulting to `pending` and `failed` limits accidental overuse, and a separate force-refresh action makes the higher-cost path explicit.

### Location conflicts

Refreshing spreadsheet/manual rows can re-trigger EXIF conflicts for photos. This is expected behavior and should remain visible through the existing conflict panel.

## Implementation Order

1. Add failing tests for asset geocode refresh and preview behavior.
2. Implement service and repository refresh helpers.
3. Add asset-level API action.
4. Add bulk refresh API action.
5. Add detail-page preview and refresh UI.
6. Add sync-page bulk refresh panel.
7. Run full verification.
