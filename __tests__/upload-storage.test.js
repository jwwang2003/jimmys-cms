/* eslint-disable @typescript-eslint/no-require-imports */
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: "commonjs", moduleResolution: "node" });
require("ts-node/register/transpile-only");

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");

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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jimmys-cms-upload-storage-"));
  const dbPath = path.join(tempDir, "upload-storage.sqlite");
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
      },
      async () => {
        delete require.cache[require.resolve("../src/db/index.ts")];
        delete require.cache[require.resolve("../src/lib/media/repository.ts")];
        delete require.cache[require.resolve("../src/lib/media/service.ts")];

        ({ sqlite } = require("../src/db/index.ts"));
        const { uploadMediaAsset } = require("../src/lib/media/service.ts");

        const asset = await uploadMediaAsset({
          storageId: "default",
          prefix: "content",
          fileName: "001+Casamar+20190419.JPG",
          bytes: new Uint8Array([1, 2, 3]),
          mimeType: "image/jpeg",
        });

        assert.ok(asset);
        assert.match(asset.object_key, /^content\/images\/[a-f0-9-]+\.jpg$/i);
        assert.equal(asset.object_key.includes("Casamar"), false);
        assert.equal(asset.filename, "001+Casamar+20190419.JPG");

        const stored = sqlite.prepare(`
          select object_key, original_filename as filename
          from media_assets
          where id = ?
        `).get(asset.id);

        assert.equal(stored.filename, "001+Casamar+20190419.JPG");
        assert.match(stored.object_key, /^content\/images\/[a-f0-9-]+\.jpg$/i);
      }
    );

    console.log("upload-storage.test.js ok");
  } finally {
    if (sqlite) {
      sqlite.close();
    }
    delete require.cache[require.resolve("../src/db/index.ts")];
    delete require.cache[require.resolve("../src/lib/media/repository.ts")];
    delete require.cache[require.resolve("../src/lib/media/service.ts")];
    delete process.env.SQLITE_URL;
    delete process.env.S3_BUCKET;
    delete process.env.AWS_REGION;
    delete process.env.CONTENT_PREFIX;
    delete process.env.MEDIA_PREFIX;
    delete process.env.PUBLIC_PREFIX;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup failures */
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
