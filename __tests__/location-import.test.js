/* eslint-disable @typescript-eslint/no-require-imports */
require("ts-node/register/transpile-only");

const assert = require("node:assert/strict");

const { parseLocationCsv } = require("../src/lib/media/location-csv.ts");

(async () => {
  const rows = parseLocationCsv(`asset_id,object_key,address,label\n1,,Sydney Opera House,Hero\n,media/videos/launch.mp4,New York Harbor,Launch`);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].assetId, 1);
  assert.equal(rows[0].rawAddress, "Sydney Opera House");
  assert.equal(rows[0].label, "Hero");
  assert.equal(rows[1].objectKey, "media/videos/launch.mp4");
  assert.equal(rows[1].rawAddress, "New York Harbor");

  console.log("location-import.test.js ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
