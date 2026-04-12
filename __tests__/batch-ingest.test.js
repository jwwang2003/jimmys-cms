/* eslint-disable @typescript-eslint/no-require-imports */
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: "commonjs", moduleResolution: "node" });
require("ts-node/register/transpile-only");

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jimmys-cms-batch-"));
  const dbPath = path.join(tempDir, "batch.sqlite");
  const db = new Database(dbPath);

  try {
    const migrationSql = fs
      .readFileSync(path.join(process.cwd(), "drizzle", "0000_careless_the_captain.sql"), "utf8")
      .replaceAll("--> statement-breakpoint", "");
    db.exec(migrationSql);
    db.prepare(`
      insert into storage_locations (id, bucket_name, region, base_url, created_at, updated_at)
      values ('default', 's3.glorialan.com', 'us-east-2', null, ?, ?)
    `).run(Date.now(), Date.now());

    const { batchIngestMediaIntoDb } = require("../src/lib/media/spreadsheet-import.ts");

    const summary = await batchIngestMediaIntoDb(db, {
      spreadsheet: {
        fileName: "batch.csv",
        bytes: Buffer.from("external_id,address,tags,collection,country,city,place\n4,Tokyo Tower,\"night,travel\",City Walks,Japan,Tokyo,Tokyo Tower\n", "utf8"),
      },
      mediaFiles: [
        {
          fileName: "4+Tokyo Tower+20240101.jpg",
          mimeType: "image/jpeg",
          bytes: new Uint8Array([1, 2, 3]),
        },
      ],
      persistFile: async ({ fileName, mimeType, mediaType }) => {
        const result = db.prepare(`
          insert into media_assets (
            title, slug, media_type, storage_id, object_key, object_url, mime_type, size_bytes, status, visibility, created_at, updated_at
          )
          values (?, ?, ?, 'default', ?, ?, ?, ?, 'draft', 'private', ?, ?)
        `).run(
          fileName,
          fileName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          mediaType,
          `content/${fileName}`,
          `https://s3.glorialan.com.s3.us-east-2.amazonaws.com/content/${fileName}`,
          mimeType,
          3,
          Date.now(),
          Date.now()
        );

        return {
          assetId: Number(result.lastInsertRowid),
          mediaType,
        };
      },
    });

    assert.equal(summary.files, 1);
    assert.equal(summary.imported, 1);
    assert.equal(summary.unmatchedFiles, 0);
    assert.equal(summary.invalidFiles, 0);

    const asset = db.prepare("select title, metadata_json from media_assets limit 1").get();
    assert.equal(asset.title, "Tokyo Tower");
    const metadata = JSON.parse(asset.metadata_json || "{}");
    assert.equal(metadata.spreadsheet.externalId, "4");
    assert.equal(metadata.filename.id, "4");

    const tags = db.prepare(`
      select t.slug
      from media_tags mt
      join tags t on t.id = mt.tag_id
      order by t.slug asc
    `).all().map((row) => row.slug);
    assert.deepEqual(tags, ["night", "travel"]);

    const location = db.prepare("select raw_address from asset_locations limit 1").get();
    assert.equal(location.raw_address, "Tokyo Tower");

    console.log("batch-ingest.test.js ok");
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
