/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

(() => {
  const layoutPath = path.join(process.cwd(), "src", "app", "admin", "layout.tsx");
  const layoutSource = fs.readFileSync(layoutPath, "utf8");

  assert.equal(layoutSource.includes("AppShell.Navbar"), false);
  assert.equal(layoutSource.includes("AppShell.Main"), false);

  const assetDetailPath = path.join(process.cwd(), "src", "app", "admin", "media", "[id]", "page.tsx");
  const assetDetailSource = fs.readFileSync(assetDetailPath, "utf8");
  assert.equal(assetDetailSource.includes("AssetPreviewCard"), true);

  const assetEditorPath = path.join(process.cwd(), "src", "components", "admin", "AssetEditor.tsx");
  const assetEditorSource = fs.readFileSync(assetEditorPath, "utf8");
  assert.equal(assetEditorSource.includes("GeocodeRefreshPanel"), true);

  const syncPagePath = path.join(process.cwd(), "src", "app", "admin", "media", "sync", "page.tsx");
  const syncPageSource = fs.readFileSync(syncPagePath, "utf8");
  assert.equal(syncPageSource.includes("GeocodeRefreshPanel"), true);

  console.log("admin-layout.test.js ok");
})();
