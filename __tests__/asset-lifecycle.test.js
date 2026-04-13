/* eslint-disable @typescript-eslint/no-require-imports */
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: "commonjs", moduleResolution: "node" });
require("ts-node/register/transpile-only");

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jimmys-cms-lifecycle-"));
  const dbPath = path.join(tempDir, "lifecycle.sqlite");
  const db = new Database(dbPath);
  const originalResolveFilename = Module._resolveFilename;
  let importedSqlite = null;

  try {
    process.env.SQLITE_URL = dbPath;
    Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
      if (typeof request === "string" && request.startsWith("@/")) {
        request = path.join(process.cwd(), "src", request.slice(2));
      }
      return originalResolveFilename.call(this, request, parent, isMain, options);
    };

    const migrationSql = fs
      .readFileSync(path.join(process.cwd(), "drizzle", "0001_asset_integrity_lifecycle.sql"), "utf8")
      .replaceAll("--> statement-breakpoint", "");
    db.exec(fs.readFileSync(path.join(process.cwd(), "drizzle", "0000_careless_the_captain.sql"), "utf8").replaceAll("--> statement-breakpoint", ""));
    db.exec(migrationSql);

    const {
      archiveMediaAsset,
      listMediaAssets,
      permanentlyDeleteMediaAsset,
      restoreMediaAsset,
      trashMediaAsset,
    } = require("../src/lib/media/repository.ts");
    ({ sqlite: importedSqlite } = require("../src/db/index.ts"));

    db.prepare(`
      insert into storage_locations (id, bucket_name, region, base_url, created_at, updated_at)
      values ('default', 's3.glorialan.com', 'us-east-2', null, ?, ?)
    `).run(Date.now(), Date.now());

    const insertResult = db.prepare(`
      insert into media_assets (
        title, slug, media_type, storage_id, object_key, object_url, mime_type, size_bytes,
        status, visibility, created_at, updated_at
      )
      values (?, ?, 'image', 'default', ?, ?, 'image/jpeg', 12, 'draft', 'private', ?, ?)
    `).run("Harbor", "harbor", "content/harbor.jpg", "https://example/harbor.jpg", Date.now(), Date.now());

    const row = db.prepare(`
      select lifecycle_status, integrity_status, trashed_at, last_verified_at
      from media_assets
      where id = ?
    `).get(insertResult.lastInsertRowid);

    assert.equal(row.lifecycle_status, "active");
    assert.equal(row.integrity_status, "ok");
    assert.equal(row.trashed_at, null);
    assert.equal(row.last_verified_at, null);

    assert.throws(
      () => {
        db.prepare(`
          insert into media_assets (
            title, slug, media_type, storage_id, object_key, object_url, mime_type, size_bytes,
            status, visibility, lifecycle_status, integrity_status, created_at, updated_at
          )
          values (?, ?, 'image', 'default', ?, ?, 'image/jpeg', 12, 'draft', 'private', ?, ?, ?, ?)
        `).run(
          "Harbor Invalid",
          "harbor-invalid",
          "content/harbor-invalid.jpg",
          "https://example/harbor-invalid.jpg",
          "nope",
          "bad",
          Date.now(),
          Date.now(),
        );
      },
      /CHECK constraint failed: media_assets_lifecycle_status_check/
    );

    archiveMediaAsset(Number(insertResult.lastInsertRowid));
    let asset = db.prepare(`
      select status, lifecycle_status
      from media_assets
      where id = ?
    `).get(insertResult.lastInsertRowid);
    assert.equal(asset.status, "archived");
    assert.equal(asset.lifecycle_status, "active");

    trashMediaAsset(Number(insertResult.lastInsertRowid));
    asset = db.prepare(`
      select lifecycle_status, trashed_at
      from media_assets
      where id = ?
    `).get(insertResult.lastInsertRowid);
    assert.equal(asset.lifecycle_status, "trashed");
    assert.equal(typeof asset.trashed_at, "number");

    const secondInsert = db.prepare(`
      insert into media_assets (
        title, slug, media_type, storage_id, object_key, object_url, mime_type, size_bytes,
        status, visibility, lifecycle_status, integrity_status, created_at, updated_at
      )
      values (?, ?, 'image', 'default', ?, ?, 'image/jpeg', 24, 'review', 'private', 'trashed', 'missing', ?, ?)
    `).run("Pier", "pier", "content/pier.jpg", "https://example/pier.jpg", Date.now(), Date.now());

    let listed = listMediaAssets();
    assert.equal(listed.length, 0);

    restoreMediaAsset(Number(insertResult.lastInsertRowid));
    asset = db.prepare(`
      select lifecycle_status, trashed_at
      from media_assets
      where id = ?
    `).get(insertResult.lastInsertRowid);
    assert.equal(asset.lifecycle_status, "active");
    assert.equal(asset.trashed_at, null);

    listed = listMediaAssets();
    assert.deepEqual(listed.map((item) => item.id), [Number(insertResult.lastInsertRowid)]);

    listed = listMediaAssets({ lifecycleStatus: "all" });
    assert.deepEqual(
      listed.map((item) => item.id).sort((left, right) => left - right),
      [Number(insertResult.lastInsertRowid), Number(secondInsert.lastInsertRowid)]
    );

    listed = listMediaAssets({ lifecycleStatus: "trashed" });
    assert.deepEqual(listed.map((item) => item.id), [Number(secondInsert.lastInsertRowid)]);

    listed = listMediaAssets({ lifecycleStatus: "all", integrityStatus: "missing" });
    assert.deepEqual(listed.map((item) => item.id), [Number(secondInsert.lastInsertRowid)]);

    permanentlyDeleteMediaAsset(Number(insertResult.lastInsertRowid));
    const deleted = db.prepare("select id from media_assets where id = ?").get(insertResult.lastInsertRowid);
    assert.equal(deleted, undefined);

    console.log("asset-lifecycle.test.js ok");
  } finally {
    Module._resolveFilename = originalResolveFilename;
    delete process.env.SQLITE_URL;
    importedSqlite?.close();
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
