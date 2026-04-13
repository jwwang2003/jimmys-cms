/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function collectFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else if (entry.isFile() && fullPath.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }
  return files;
}

(() => {
  const roots = [
    path.join(process.cwd(), "src", "app"),
    path.join(process.cwd(), "src", "components"),
  ];

  const offenders = [];
  for (const root of roots) {
    for (const file of collectFiles(root)) {
      const source = fs.readFileSync(file, "utf8");
      if (/AppShell\.(Navbar|Header|Main|Aside|Footer|Section)/.test(source) || /Table\.(Thead|Tbody|Tr|Th|Td)/.test(source)) {
        offenders.push(path.relative(process.cwd(), file));
      }
    }
  }

  assert.deepEqual(offenders, []);

  const previewCardPath = path.join(process.cwd(), "src", "components", "admin", "AssetPreviewCard.tsx");
  const previewCardSource = fs.readFileSync(previewCardPath, "utf8");
  assert.equal(previewCardSource.includes("No browser preview available"), true);
  assert.equal(previewCardSource.includes("Preview unavailable"), true);
  assert.equal(previewCardSource.includes("integrity_status"), true);
  assert.equal(previewCardSource.includes("asset.tags"), true);

  const geocodePanelPath = path.join(process.cwd(), "src", "components", "admin", "GeocodeRefreshPanel.tsx");
  const geocodePanelSource = fs.readFileSync(geocodePanelPath, "utf8");
  assert.equal(geocodePanelSource.includes("refreshGeocode"), true);
  assert.equal(geocodePanelSource.includes("refreshManyGeocodes"), true);
  assert.equal(geocodePanelSource.includes("Guests can review location status but cannot refresh geocodes."), true);

  const assetEditorPath = path.join(process.cwd(), "src", "components", "admin", "AssetEditor.tsx");
  const assetEditorSource = fs.readFileSync(assetEditorPath, "utf8");
  assert.equal(assetEditorSource.includes("Filename"), true);
  assert.equal(assetEditorSource.includes("Display filename"), false);
  assert.equal(assetEditorSource.includes("Original filename"), false);
  assert.equal(assetEditorSource.includes("Add tag"), true);
  assert.equal(assetEditorSource.includes("Remove tag"), true);
  assert.equal(assetEditorSource.includes("Pill"), true);

  const assetTablePath = path.join(process.cwd(), "src", "components", "admin", "AssetTable.tsx");
  const assetTableSource = fs.readFileSync(assetTablePath, "utf8");
  assert.equal(assetTableSource.includes("Pill"), true);

  const mantineRegistryPath = path.join(process.cwd(), "src", "app", "mantine-registry.tsx");
  const mantineRegistrySource = fs.readFileSync(mantineRegistryPath, "utf8");
  assert.equal(mantineRegistrySource.includes("forceColorScheme=\"dark\""), true);

  const batchFormPath = path.join(process.cwd(), "src", "components", "admin", "BatchIngestForm.tsx");
  const batchFormSource = fs.readFileSync(batchFormPath, "utf8");
  assert.equal(batchFormSource.includes("EventSource"), true);
  assert.equal(batchFormSource.includes("Overall progress"), true);

  console.log("mantine-static-subcomponents.test.js ok");
})();
