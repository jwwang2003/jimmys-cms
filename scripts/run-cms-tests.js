/* eslint-disable @typescript-eslint/no-require-imports */
const { spawnSync } = require("node:child_process");

const tests = [
  "__tests__/session.test.js",
  "__tests__/cms-bootstrap.test.js",
  "__tests__/media-normalization.test.js",
  "__tests__/media-api-contract.test.js",
  "__tests__/location-import.test.js",
  "__tests__/google-maps.test.js",
  "__tests__/spreadsheet-parser.test.js",
  "__tests__/metadata-ingest.test.js",
  "__tests__/batch-ingest.test.js",
  "__tests__/batch-ingest-jobs.test.js",
  "__tests__/spreadsheet-upload-contract.test.js",
  "__tests__/upload-storage.test.js",
  "__tests__/photo-exif.test.js",
  "__tests__/derive.test.js",
  "__tests__/asset-lifecycle.test.js",
  "__tests__/asset-integrity.test.js",
  "__tests__/admin-layout.test.js",
  "__tests__/mantine-static-subcomponents.test.js",
  "__tests__/package-scripts.test.js",
];

for (const testFile of tests) {
  const result = spawnSync(process.execPath, [testFile], { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
