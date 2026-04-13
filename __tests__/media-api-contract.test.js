/* eslint-disable @typescript-eslint/no-require-imports */
require("ts-node/register/transpile-only");

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { normalizeAssetUpdatePayload } = require("../src/lib/media/forms.ts");

(async () => {
  const payload = normalizeAssetUpdatePayload({
    title: "Harbor Sunset",
    filename: "harbor-sunset.jpg",
    description: "Evening light",
    tagSlugs: "travel, sunset , harbor",
    collectionNames: "Summer Set,Hero Picks",
    rawAddress: "Sydney Opera House",
    formattedAddress: "Sydney Opera House, Bennelong Point NSW 2000, Australia",
    lat: "-33.8568",
    lng: "151.2153",
  });

  assert.equal(payload.title, "Harbor Sunset");
  assert.equal(payload.filename, "harbor-sunset.jpg");
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "originalFilename"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "displayFilename"), false);
  assert.deepEqual(payload.tagSlugs, ["travel", "sunset", "harbor"]);
  assert.deepEqual(payload.collectionNames, ["Summer Set", "Hero Picks"]);
  assert.equal(payload.locations.length, 1);
  assert.equal(payload.locations[0].isPrimary, true);
  const filtersSource = fs.readFileSync(path.join(process.cwd(), "src", "components", "admin", "AssetFilters.tsx"), "utf8");
  assert.equal(filtersSource.includes("lifecycleStatus"), true);
  assert.equal(filtersSource.includes("integrityStatus"), true);
  const assetRouteSource = fs.readFileSync(
    path.join(process.cwd(), "src", "app", "api", "admin", "media", "[id]", "route.ts"),
    "utf8"
  );
  assert.equal(assetRouteSource.includes("refreshGeocode"), true);

  const actionsRouteSource = fs.readFileSync(
    path.join(process.cwd(), "src", "app", "api", "admin", "media", "actions", "route.ts"),
    "utf8"
  );
  assert.equal(actionsRouteSource.includes("refreshManyGeocodes"), true);

  console.log("media-api-contract.test.js ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
