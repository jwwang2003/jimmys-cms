/* eslint-disable @typescript-eslint/no-require-imports */
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: "commonjs", moduleResolution: "node" });
require("ts-node/register/transpile-only");

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
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
  const batchFormSource = fs.readFileSync(path.join(process.cwd(), "src", "components", "admin", "BatchIngestForm.tsx"), "utf8");
  const metadataFormSource = fs.readFileSync(path.join(process.cwd(), "src", "components", "admin", "SpreadsheetImportForm.tsx"), "utf8");

  assert.equal(batchFormSource.includes('form.append("spreadsheet", spreadsheetFile)'), true);
  assert.equal(batchFormSource.includes("spreadsheetFileName"), false);
  assert.equal(metadataFormSource.includes('form.append("spreadsheet", spreadsheetFile)'), true);
  assert.equal(metadataFormSource.includes('type=\"file\"'), true);

  const spreadsheet = new File(["external_id,tags\n4,travel\n"], "import.csv", { type: "text/csv" });
  const media = new File([Uint8Array.from([1, 2, 3])], "4+Harbor+20240101.jpg", { type: "image/jpeg" });

  await withModuleMocks({
    "@/lib/session": { getCurrentSession: async () => ({ userId: "u1", role: "admin" }) },
    "@/lib/authz": { canEdit: () => true },
    "@/lib/google-maps": { hasGoogleMapsKey: () => false },
    "@/lib/media/ingest-jobs": {
      createAndRunBatchIngestJob: async (input) => {
        assert.equal(input.spreadsheet.fileName, "import.csv");
        assert.equal(input.files.length, 1);
        return { id: 42 };
      },
    },
  }, async () => {
    delete require.cache[require.resolve("../src/app/api/admin/media/batch-import/route.ts")];
    const batchRoute = require("../src/app/api/admin/media/batch-import/route.ts");

    const batchForm = new FormData();
    batchForm.append("spreadsheet", spreadsheet);
    batchForm.append("files", media);
    const batchResponse = await batchRoute.POST(
      new Request("http://localhost/api/admin/media/batch-import", { method: "POST", body: batchForm })
    );
    const batchJson = await batchResponse.json();
    assert.equal(batchResponse.status, 200);
    assert.equal(batchJson.jobId, 42);
    assert.equal(batchJson.summary, undefined);
  });

  await withModuleMocks({
    "@/lib/session": { getCurrentSession: async () => ({ userId: "u1", role: "admin" }) },
    "@/lib/authz": { canEdit: () => true },
    "@/lib/google-maps": { hasGoogleMapsKey: () => false },
    "@/lib/media/spreadsheet-import": {
      importMediaSpreadsheetIntoDb: async (_db, input) => {
        assert.equal(input.fileName, "import.csv");
        return { rows: 1, imported: 1, unmatched: 0, updatedTags: 1, updatedCollections: 0 };
      },
    },
    "@/db": { db: {} },
  }, async () => {
    delete require.cache[require.resolve("../src/app/api/admin/media/metadata-import/route.ts")];
    const metadataRoute = require("../src/app/api/admin/media/metadata-import/route.ts");

    const metadataForm = new FormData();
    metadataForm.append("spreadsheet", spreadsheet);
    const metadataResponse = await metadataRoute.POST(
      new Request("http://localhost/api/admin/media/metadata-import", { method: "POST", body: metadataForm })
    );
    const metadataJson = await metadataResponse.json();
    assert.equal(metadataResponse.status, 200);
    assert.equal(metadataJson.summary.imported, 1);
  });

  console.log("spreadsheet-upload-contract.test.js ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
