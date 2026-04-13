/* eslint-disable @typescript-eslint/no-require-imports */
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: "commonjs", moduleResolution: "node" });
require("ts-node/register/transpile-only");

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jimmys-cms-lifecycle-"));
  const dbPath = path.join(tempDir, "lifecycle.sqlite");
  const db = new Database(dbPath);

  try {
    const migrationSql = fs
      .readFileSync(path.join(process.cwd(), "drizzle", "0001_asset_integrity_lifecycle.sql"), "utf8")
      .replaceAll("--> statement-breakpoint", "");
    db.exec(fs.readFileSync(path.join(process.cwd(), "drizzle", "0000_careless_the_captain.sql"), "utf8").replaceAll("--> statement-breakpoint", ""));
    db.exec(migrationSql);

    db.prepare(`
      insert into storage_locations (id, bucket_name, region, base_url, created_at, updated_at)
      values ('default', 's3.glorialan.com', 'us-east-2', null, ?, ?)
    `).run(Date.now(), Date.now());

    db.prepare(`
      insert into media_assets (
        title, slug, media_type, storage_id, object_key, object_url, mime_type, size_bytes,
        status, visibility, lifecycle_status, integrity_status, created_at, updated_at
      )
      values (?, ?, 'image', 'default', ?, ?, 'image/jpeg', 12, 'draft', 'private', 'active', 'ok', ?, ?)
    `).run("Harbor", "harbor", "content/harbor.jpg", "https://example/harbor.jpg", Date.now(), Date.now());

    const row = db.prepare(`
      select lifecycle_status, integrity_status, trashed_at, last_verified_at
      from media_assets
      where id = 1
    `).get();

    assert.equal(row.lifecycle_status, "active");
    assert.equal(row.integrity_status, "ok");
    assert.equal(row.trashed_at, null);
    assert.equal(row.last_verified_at, null);

    console.log("asset-lifecycle.test.js ok");
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
