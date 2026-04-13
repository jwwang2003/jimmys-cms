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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jimmys-cms-ingest-jobs-"));
  const dbPath = path.join(tempDir, "ingest-jobs.sqlite");
  let sqlite = null;

  process.env.SQLITE_URL = dbPath;
  process.env.S3_BUCKET = "s3.glorialan.com";
  process.env.AWS_REGION = "us-east-2";
  process.env.CONTENT_PREFIX = "content";
  process.env.MEDIA_PREFIX = "media";
  process.env.PUBLIC_PREFIX = "public";

  try {
    await withModuleMocks({}, async () => {
      delete require.cache[require.resolve("../src/db/index.ts")];
      delete require.cache[require.resolve("../src/lib/media/ingest-jobs.ts")];

      ({ sqlite } = require("../src/db/index.ts"));
      const {
        createBatchIngestJob,
        updateBatchIngestJobItem,
        getBatchIngestJobSnapshot,
        finalizeBatchIngestJob,
      } = require("../src/lib/media/ingest-jobs.ts");

      const job = createBatchIngestJob({
        spreadsheetFileName: "batch.xlsx",
        createdBy: null,
        files: [
          { fileName: "001+Casamar+20190419.JPG", mimeType: "image/jpeg" },
          { fileName: "002+Casamar+20190601.JPG", mimeType: "image/jpeg" },
        ],
      });

      updateBatchIngestJobItem(job.id, 0, {
        status: "uploading",
        progressPercent: 40,
        detail: { step: "uploading" },
      });
      updateBatchIngestJobItem(job.id, 0, {
        status: "completed",
        progressPercent: 100,
      });

      const runningSnapshot = getBatchIngestJobSnapshot(job.id);
      assert.equal(runningSnapshot.job.total_items, 2);
      assert.equal(runningSnapshot.job.processed_items, 1);
      assert.equal(runningSnapshot.items[0].status, "completed");
      assert.equal(runningSnapshot.items[0].progress_percent, 100);

      finalizeBatchIngestJob(job.id, {
        status: "completed",
        summary: { imported: 1, failed: 0, warnings: 0 },
      });

      const finalSnapshot = getBatchIngestJobSnapshot(job.id);
      assert.equal(finalSnapshot.job.status, "completed");
      assert.equal(finalSnapshot.job.summary_json.includes("\"imported\":1"), true);

      const staleUserJob = createBatchIngestJob({
        spreadsheetFileName: "stale-user.xlsx",
        createdBy: "missing-user-id",
        files: [{ fileName: "003+Casamar+20190614.JPG", mimeType: "image/jpeg" }],
      });

      const staleUserSnapshot = getBatchIngestJobSnapshot(staleUserJob.id);
      assert.equal(staleUserSnapshot.job.created_by, null);
    });

    console.log("batch-ingest-jobs.test.js ok");
  } finally {
    if (sqlite) {
      sqlite.close();
    }
    delete require.cache[require.resolve("../src/db/index.ts")];
    delete require.cache[require.resolve("../src/lib/media/ingest-jobs.ts")];
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
