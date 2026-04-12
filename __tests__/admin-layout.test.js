/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

(() => {
  const filePath = path.join(process.cwd(), "src", "app", "admin", "layout.tsx");
  const source = fs.readFileSync(filePath, "utf8");

  assert.equal(source.includes("AppShell.Navbar"), false);
  assert.equal(source.includes("AppShell.Main"), false);

  console.log("admin-layout.test.js ok");
})();
