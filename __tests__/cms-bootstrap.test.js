/* eslint-disable @typescript-eslint/no-require-imports */
require("ts-node/register/transpile-only");

const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");

const { ensureCmsDefaults } = require("../src/db/bootstrap.ts");

(async () => {
  process.env.S3_BUCKET = "s3.glorialan.com";
  process.env.AWS_REGION = "us-east-2";
  process.env.CONTENT_PREFIX = "content";
  process.env.MEDIA_PREFIX = "media";
  process.env.PUBLIC_PREFIX = "public";

  const db = new DatabaseSync(":memory:");

  db.exec(`
    CREATE TABLE storage_locations (
      id TEXT PRIMARY KEY,
      bucket_name TEXT NOT NULL,
      region TEXT NOT NULL,
      base_url TEXT,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE storage_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storage_id TEXT NOT NULL,
      folder_type TEXT NOT NULL,
      prefix TEXT NOT NULL,
      description TEXT,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE UNIQUE INDEX storage_folders_type_unique ON storage_folders(storage_id, folder_type);
  `);

  ensureCmsDefaults(db);

  const location = db.prepare("select * from storage_locations where id = 'default'").get();
  assert.equal(location.bucket_name, "s3.glorialan.com");
  assert.equal(location.region, "us-east-2");

  const folders = db.prepare("select folder_type, prefix from storage_folders order by folder_type asc").all();
  assert.equal(folders.length, 4);
  assert.ok(folders.some((folder) => folder.folder_type === "images" && folder.prefix === "content"));
  assert.ok(folders.some((folder) => folder.folder_type === "videos" && folder.prefix === "media"));

  console.log("cms-bootstrap.test.js ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
