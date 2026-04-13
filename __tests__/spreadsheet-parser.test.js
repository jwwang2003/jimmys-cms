/* eslint-disable @typescript-eslint/no-require-imports */
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: "commonjs", moduleResolution: "node" });
require("ts-node/register/transpile-only");

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { parseMetadataSpreadsheet, parseMetadataSpreadsheetV1 } = require("../src/lib/media/spreadsheet.ts");

(async () => {
  assert.equal(typeof parseMetadataSpreadsheetV1, "function");

  const artworkBuffer = fs.readFileSync(path.join(process.cwd(), "data", "artwork_v1_0.xlsx"));
  const artwork = parseMetadataSpreadsheet({
    fileName: "artwork_v1_0.xlsx",
    bytes: artworkBuffer,
  });

  assert.equal(artwork.rows.length > 0, true);
  const tokyoRow = artwork.rows.find((row) => row.externalId === "4");
  assert.ok(tokyoRow);
  assert.equal(tokyoRow.country, "Japan");
  assert.equal(tokyoRow.city, "Tokyo");
  assert.equal(tokyoRow.locationLabel, "ばん屋");
  assert.equal(tokyoRow.rawAddress.includes("Shibuya"), true);
  assert.deepEqual(tokyoRow.tagSlugs, ["shop", "临摹"]);

  const csv = parseMetadataSpreadsheet({
    fileName: "sample.csv",
    bytes: Buffer.from("asset_id,address,tags,collection\n7,Tokyo Tower,\"travel,night\",City Walks\n", "utf8"),
  });
  assert.equal(csv.rows.length, 1);
  assert.equal(csv.rows[0].assetId, 7);
  assert.equal(csv.rows[0].rawAddress, "Tokyo Tower");
  assert.deepEqual(csv.rows[0].tagSlugs, ["travel", "night"]);
  assert.deepEqual(csv.rows[0].collectionNames, ["City Walks"]);

  const photographyBuffer = fs.readFileSync(path.join(process.cwd(), "data", "photography_v1_0.xlsx"));
  const photography = parseMetadataSpreadsheet({
    fileName: "photography_v1_0.xlsx",
    bytes: photographyBuffer,
  });

  assert.equal(photography.rows.length > 0, true);
  const panamaRow = photography.rows.find((row) => row.externalId === "1");
  assert.ok(panamaRow);
  assert.equal(panamaRow.country, "Panama");
  assert.equal(panamaRow.city, "San Carlos");
  assert.equal(panamaRow.locationLabel, "Casamar");
  assert.deepEqual(panamaRow.tagSlugs, ["beach", "scenery", "sunrise"]);

  const messyTags = parseMetadataSpreadsheet({
    fileName: "messy-tags.csv",
    bytes: Buffer.from(
      "external_id,\u6807\u7b7e/\u98ce\u683c\n4,\"  travel, night , portrait\uff1b documentary\r\n city  \"\n",
      "utf8",
    ),
  });
  assert.equal(messyTags.rows.length, 1);
  assert.deepEqual(messyTags.rows[0].tagSlugs, ["travel", "night", "portrait", "documentary", "city"]);

  console.log("spreadsheet-parser.test.js ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
