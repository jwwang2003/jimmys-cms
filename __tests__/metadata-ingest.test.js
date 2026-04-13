/* eslint-disable @typescript-eslint/no-require-imports */
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: "commonjs", moduleResolution: "node" });
require("ts-node/register/transpile-only");

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");

function applyAllDrizzleMigrations(database) {
  const migrations = fs
    .readdirSync(path.join(process.cwd(), "drizzle"))
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
  if (migrations.length === 0) {
    throw new Error("Missing drizzle SQL migrations");
  }
  for (const migration of migrations) {
    database.exec(
      fs.readFileSync(path.join(process.cwd(), "drizzle", migration), "utf8").replaceAll("--> statement-breakpoint", "")
    );
  }
}

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jimmys-cms-ingest-"));
  const dbPath = path.join(tempDir, "ingest.sqlite");

  process.env.SQLITE_URL = dbPath;
  process.env.S3_BUCKET = "s3.glorialan.com";
  process.env.AWS_REGION = "us-east-2";
  process.env.CONTENT_PREFIX = "content";
  process.env.MEDIA_PREFIX = "media";
  process.env.PUBLIC_PREFIX = "public";

  const bootstrapDb = new Database(dbPath);
  try {
    applyAllDrizzleMigrations(bootstrapDb);
  } finally {
    bootstrapDb.close();
  }

  const sqlite = new Database(dbPath);
  sqlite
    .prepare(`
      insert into storage_locations (id, bucket_name, region, base_url, created_at, updated_at)
      values ('default', 's3.glorialan.com', 'us-east-2', null, ?, ?)
    `)
    .run(Date.now(), Date.now());
  const { importMediaSpreadsheetIntoDb } = require("../src/lib/media/spreadsheet-import.ts");

  sqlite
    .prepare(`
      insert into media_assets (
        title, slug, media_type, storage_id, object_key, object_url, mime_type, size_bytes, status, visibility, created_at, updated_at
      )
      values (?, ?, 'image', 'default', ?, ?, 'image/jpeg', 1024, 'draft', 'private', ?, ?)
    `)
    .run(
      "Artwork 4",
      "artwork-4",
      "content/4.jpg",
      "https://s3.glorialan.com.s3.us-east-2.amazonaws.com/content/4.jpg",
      Date.now(),
      Date.now()
    );

  const summary = await importMediaSpreadsheetIntoDb(sqlite, {
    fileName: "artwork_v1_0.xlsx",
    bytes: fs.readFileSync(path.join(process.cwd(), "data", "artwork_v1_0.xlsx")),
  });

  assert.equal(summary.rows > 0, true);
  assert.equal(summary.imported, 1);
  assert.equal(summary.unmatched > 0, true);

  const tags = sqlite.prepare(`
    select t.slug
    from media_tags mt
    join tags t on t.id = mt.tag_id
    where mt.asset_id = 1
    order by t.slug asc
  `).all().map((row) => row.slug);
  assert.ok(tags.includes("shop"));
  assert.ok(tags.includes("临摹"));

  const locations = sqlite.prepare("select raw_address from asset_locations where asset_id = 1").all();
  assert.equal(locations.length, 1);
  assert.equal(locations[0].raw_address.includes("Shibuya"), true);

  const asset = sqlite.prepare("select metadata_json from media_assets where id = 1").get();
  const metadata = JSON.parse(asset.metadata_json || "{}");
  assert.equal(metadata.spreadsheet.externalId, "4");
  assert.equal(metadata.spreadsheet.country, "Japan");
  assert.equal(metadata.spreadsheet.sourceFile, "artwork_v1_0.xlsx");

  sqlite.prepare(`
    insert into tags (label, slug, created_at)
    values ('Travel', 'travel', ?)
  `).run(Date.now());
  sqlite.prepare(`
    insert into media_assets (
      title, slug, media_type, storage_id, object_key, object_url, mime_type, size_bytes, status, visibility, created_at, updated_at
    )
    values (?, ?, 'image', 'default', ?, ?, 'image/jpeg', 1024, 'draft', 'private', ?, ?)
  `).run(
    "Artwork 9",
    "artwork-9",
    "content/9.jpg",
    "https://s3.glorialan.com.s3.us-east-2.amazonaws.com/content/9.jpg",
    Date.now(),
    Date.now()
  );

  const messySummary = await importMediaSpreadsheetIntoDb(sqlite, {
    fileName: "messy-tags.csv",
    bytes: Buffer.from(
      "external_id,\u6807\u7b7e/\u98ce\u683c\n9,\"  Travel, night , portrait\uff1b documentary  \"\n",
      "utf8",
    ),
  });

  assert.equal(messySummary.imported, 1);
  const messyTags = sqlite.prepare(`
    select t.label, t.slug
    from media_tags mt
    join tags t on t.id = mt.tag_id
    where mt.asset_id = 2
    order by t.slug asc
  `).all();
  assert.deepEqual(
    messyTags,
    [
      { label: "documentary", slug: "documentary" },
      { label: "night", slug: "night" },
      { label: "portrait", slug: "portrait" },
      { label: "Travel", slug: "travel" },
    ]
  );

  sqlite.close();
  fs.rmSync(tempDir, { recursive: true, force: true });

  console.log("metadata-ingest.test.js ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
