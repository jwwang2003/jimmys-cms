/* eslint-disable @typescript-eslint/no-require-imports */
require("ts-node/register/transpile-only");

const assert = require("node:assert/strict");

const { normalizeAssetUpdatePayload } = require("../src/lib/media/forms.ts");

(async () => {
  const payload = normalizeAssetUpdatePayload({
    title: "Harbor Sunset",
    description: "Evening light",
    tagSlugs: "travel, sunset , harbor",
    collectionNames: "Summer Set,Hero Picks",
    rawAddress: "Sydney Opera House",
    formattedAddress: "Sydney Opera House, Bennelong Point NSW 2000, Australia",
    lat: "-33.8568",
    lng: "151.2153",
  });

  assert.equal(payload.title, "Harbor Sunset");
  assert.deepEqual(payload.tagSlugs, ["travel", "sunset", "harbor"]);
  assert.deepEqual(payload.collectionNames, ["Summer Set", "Hero Picks"]);
  assert.equal(payload.locations.length, 1);
  assert.equal(payload.locations[0].isPrimary, true);

  console.log("media-api-contract.test.js ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
