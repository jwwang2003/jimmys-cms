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
  console.log("mantine-static-subcomponents.test.js ok");
})();
