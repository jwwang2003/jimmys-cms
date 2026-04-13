/* eslint-disable @typescript-eslint/no-require-imports */
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: "commonjs", moduleResolution: "node" });
require("ts-node/register/transpile-only");

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");

function buildExifJpeg() {
  const base64 =
    "/9j/4QEtRXhpZgAASUkqAAgAAAAFAA8BAgAGAAAAqgAAABABAgANAAAAsAAAABIBAwABAAAAAQAAAGmHBAABAAAASgAAACWIBAABAAAAaAAAAAAAAAACAAOQAgAUAAAAvQAAADSkAgAYAAAA0QAAAAAAAAAFAAEAAgACAAAA6QAAAAIABQADAAAA7QAAAAMAAgACAAAA6wAAAAQABQADAAAABQEAAAYABQABAAAAHQEAAAAAAABDYW5vbgBDYW5vbiBFT1MgUjUAMjAyNDowMjowMyAwNDowNTowNgBSRjI0LTcwbW0gRjIuOCBMIElTIFVTTQBOAEUAIwAAAAEAAAApAAAAAQAAAG8AAAAFAAAAiwAAAAEAAAApAAAAAQAAAPECAAAZAAAALAAAAAEAAAD/2Q==";
  return Buffer.from(base64, "base64");
}

async function withModuleMocks(mocks, run) {
  const originalLoad = Module._load;
  const originalResolveFilename = Module._resolveFilename;
  try {
    Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
      if (typeof request === "string" && request.startsWith("@/")) {
        request = path.join(process.cwd(), "src", request.slice(2));
      }
      return originalResolveFilename.call(this, request, parent, isMain, options);
    };
    Module._load = function mockLoad(request, parent, isMain) {
      if (Object.prototype.hasOwnProperty.call(mocks, request)) {
        return mocks[request];
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    return await run();
  } finally {
    Module._load = originalLoad;
    Module._resolveFilename = originalResolveFilename;
  }
}

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jimmys-cms-exif-"));
  const dbPath = path.join(tempDir, "photo-exif.sqlite");
  let sqlite = null;

  process.env.SQLITE_URL = dbPath;
  process.env.S3_BUCKET = "s3.glorialan.com";
  process.env.AWS_REGION = "us-east-2";
  process.env.CONTENT_PREFIX = "content";
  process.env.MEDIA_PREFIX = "media";
  process.env.PUBLIC_PREFIX = "public";

  try {
    await withModuleMocks(
      {
        "@/lib/s3": {
          buildKey: (prefix, ...parts) => [prefix, ...parts.filter(Boolean)].join("/"),
          getS3: () => ({
            bucket: "s3.glorialan.com",
            region: "us-east-2",
            client: {
              send: async () => ({ ok: true }),
            },
          }),
        },
        "@/lib/google-maps": {
          hasGoogleMapsKey: () => true,
          geocodeAddress: async () => ({
            formattedAddress: "Tokyo Tower, Japan",
            lat: 35.6895,
            lng: 139.6917,
            placeId: "place-1",
            rawResponseJson: JSON.stringify({ results: [{ place_id: "place-1" }] }),
          }),
        },
      },
      async () => {
        const { extractPhotoExif } = require("../src/lib/media/exif.ts");
        const parsed = extractPhotoExif(buildExifJpeg());

        assert.ok(parsed);
        assert.equal(parsed.captureDate, "2024-02-03T04:05:06.000Z");
        assert.equal(parsed.camera.make, "Canon");
        assert.equal(parsed.camera.model, "Canon EOS R5");
        assert.equal(parsed.lens.model, "RF24-70mm F2.8 L IS USM");
        assert.equal(parsed.orientation, 1);
        assert.equal(parsed.location.lat.toFixed(6), "35.689500");
        assert.equal(parsed.location.lng.toFixed(6), "139.691700");
        assert.equal(parsed.location.altitude, 44);
        assert.equal(extractPhotoExif(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])), null);

        delete require.cache[require.resolve("../src/db/index.ts")];
        delete require.cache[require.resolve("../src/lib/media/repository.ts")];
        delete require.cache[require.resolve("../src/lib/media/service.ts")];

        ({ sqlite } = require("../src/db/index.ts"));
        const repository = require("../src/lib/media/repository.ts");
        const { uploadMediaAsset } = require("../src/lib/media/service.ts");

        const asset = await uploadMediaAsset({
          storageId: "default",
          prefix: "content",
          fileName: "tokyo.jpg",
          bytes: buildExifJpeg(),
          mimeType: "image/jpeg",
        });

        assert.ok(asset);
        const storedExif = sqlite.prepare(`
          select
            pe.pixel_width,
            pe.pixel_height,
            pe.exposure_time_text,
            pe.orientation,
            pc.make as camera_make,
            pc.model as camera_model,
            pl.label as lens_label
          from photo_exif pe
          left join photo_cameras pc on pc.id = pe.camera_id
          left join photo_lenses pl on pl.id = pe.lens_id
          where pe.asset_id = ?
        `).get(asset.id);
        assert.equal(storedExif.pixel_width, null);
        assert.equal(storedExif.pixel_height, null);
        assert.equal(storedExif.exposure_time_text, null);
        assert.equal(storedExif.orientation, 1);
        assert.equal(storedExif.camera_make, "Canon");
        assert.equal(storedExif.camera_model, "Canon EOS R5");
        assert.equal(storedExif.lens_label, "RF24-70mm F2.8 L IS USM");

        const orphanCreatorAsset = await uploadMediaAsset({
          storageId: "default",
          prefix: "content",
          fileName: "tokyo-with-missing-user.jpg",
          bytes: buildExifJpeg(),
          mimeType: "image/jpeg",
          createdBy: "missing-user-id",
        });
        assert.ok(orphanCreatorAsset);
        const orphanCreatorRow = sqlite.prepare(`
          select created_by
          from media_assets
          where id = ?
        `).get(orphanCreatorAsset.id);
        assert.equal(orphanCreatorRow.created_by, null);

        let locations = sqlite.prepare(`
          select source, is_primary, lat, lng
          from asset_locations
          where asset_id = ?
          order by id asc
        `).all(asset.id);
        assert.equal(locations.length, 1);
        assert.equal(locations[0].source, "exif");
        assert.equal(locations[0].is_primary, 1);

        repository.saveImportedLocation(asset.id, "image", {
          label: "Spreadsheet pending",
          rawAddress: "Tokyo Tower",
          formattedAddress: null,
          isPrimary: true,
          source: "spreadsheet",
          status: "pending",
        });
        const refreshed = await require("../src/lib/media/service.ts").refreshMediaAssetGeolocation(asset.id);
        assert.equal(refreshed.summary.updated, 1);
        const refreshedLocation = sqlite.prepare(`
          select formatted_address, google_place_id, status
          from asset_locations
          where asset_id = ? and source = 'spreadsheet'
          order by id desc
          limit 1
        `).get(asset.id);
        assert.equal(refreshedLocation.formatted_address, "Tokyo Tower, Japan");
        assert.equal(refreshedLocation.google_place_id, "place-1");
        assert.equal(refreshedLocation.status, "matched");

        repository.saveImportedLocation(asset.id, "image", {
          label: "Spreadsheet",
          lat: 40.0001,
          lng: 116.0001,
          isPrimary: true,
          source: "spreadsheet",
          status: "matched",
        });

        const conflicts = repository.listPendingLocationConflicts(10);
        assert.equal(conflicts.length, 1);
        assert.equal(conflicts[0].assetId, asset.id);
        assert.equal(conflicts[0].status, "pending");
        assert.equal(conflicts[0].candidateLocation.source, "exif");
        assert.equal(conflicts[0].existingLocation.source, "spreadsheet");

        locations = sqlite.prepare(`
          select source, is_primary
          from asset_locations
          where asset_id = ?
          order by id asc
        `).all(asset.id);
        assert.equal(locations.find((location) => location.source === "exif").is_primary, 1);
        assert.equal(locations.find((location) => location.source === "spreadsheet").is_primary, 0);

        repository.saveImportedLocation(asset.id, "image", {
          label: "Spreadsheet exact",
          lat: 35.6895,
          lng: 139.6917,
          isPrimary: true,
          source: "spreadsheet",
          status: "matched",
        });

        const clearedConflicts = repository.listPendingLocationConflicts(10);
        assert.equal(clearedConflicts.length, 0);

        locations = sqlite.prepare(`
          select source, is_primary, status
          from asset_locations
          where asset_id = ?
          order by id asc
        `).all(asset.id);
        assert.equal(locations.find((location) => location.source === "spreadsheet").is_primary, 1);
        assert.equal(locations.find((location) => location.source === "spreadsheet").status, "matched");
        assert.equal(locations.find((location) => location.source === "exif").is_primary, 0);
        assert.equal(locations.find((location) => location.source === "exif").status, "matched");

        repository.saveImportedLocation(asset.id, "image", {
          label: "Spreadsheet again",
          lat: 40.0001,
          lng: 116.0001,
          isPrimary: true,
          source: "spreadsheet",
          status: "matched",
        });

        const recreatedConflicts = repository.listPendingLocationConflicts(10);
        assert.equal(recreatedConflicts.length, 1);
        assert.equal(recreatedConflicts[0].assetId, asset.id);
        assert.equal(recreatedConflicts[0].status, "pending");

        const resolved = repository.resolveAssetLocationConflict(recreatedConflicts[0].id, "keep_existing", null);
        assert.equal(resolved.status, "resolved");
        assert.equal(resolved.resolution, "keep_existing");

        locations = sqlite.prepare(`
          select source, is_primary
          from asset_locations
          where asset_id = ?
          order by id asc
        `).all(asset.id);
        assert.equal(locations.find((location) => location.source === "spreadsheet").is_primary, 1);
        assert.equal(locations.find((location) => location.source === "exif").is_primary, 0);

        repository.saveImportedLocation(asset.id, "image", {
          label: "Spreadsheet stale-user",
          lat: 41.0001,
          lng: 117.0001,
          isPrimary: true,
          source: "spreadsheet",
          status: "matched",
        });

        const staleUserConflicts = repository.listPendingLocationConflicts(10);
        assert.equal(staleUserConflicts.length, 1);

        const staleUserResolved = repository.resolveAssetLocationConflict(
          staleUserConflicts[0].id,
          "keep_exif",
          "missing-user-id"
        );
        assert.equal(staleUserResolved.status, "resolved");
        assert.equal(staleUserResolved.resolution, "keep_exif");
        assert.equal(staleUserResolved.resolvedBy, null);
      }
    );

    console.log("photo-exif.test.js ok");
  } finally {
    if (sqlite) {
      sqlite.close();
    }
    delete process.env.SQLITE_URL;
    delete process.env.S3_BUCKET;
    delete process.env.AWS_REGION;
    delete process.env.CONTENT_PREFIX;
    delete process.env.MEDIA_PREFIX;
    delete process.env.PUBLIC_PREFIX;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
