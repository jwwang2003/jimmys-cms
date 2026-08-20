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

  // Guest sessions are mintable by anyone, so the read routes must scope by
  // role: the list pins non-editors to public visibility, the detail route
  // 404s non-public assets, and originals are editor-only.
  const listRouteSource = fs.readFileSync(
    path.join(process.cwd(), "src", "app", "api", "admin", "media", "route.ts"),
    "utf8"
  );
  assert.equal(listRouteSource.includes('canEdit(session.role) ? searchParams.get("visibility") || "all" : "public"'), true);

  const detailRouteSource = fs.readFileSync(
    path.join(process.cwd(), "src", "app", "api", "admin", "media", "[id]", "route.ts"),
    "utf8"
  );
  assert.equal(detailRouteSource.includes('!canEdit(session.role) && asset.visibility !== "public"'), true);

  const originalRouteSource = fs.readFileSync(
    path.join(process.cwd(), "src", "app", "api", "admin", "media", "[id]", "original", "route.ts"),
    "utf8"
  );
  assert.equal(originalRouteSource.includes("canEdit(session.role)"), true);

  console.log("media-api-contract.test.js ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
