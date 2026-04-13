/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

(() => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")
  );
  assert.equal(packageJson.scripts["test:cms"], "node scripts/run-cms-tests.js");

  const runnerSource = fs.readFileSync(
    path.join(process.cwd(), "scripts", "run-cms-tests.js"),
    "utf8"
  );
  assert.equal(runnerSource.includes("__tests__/session.test.js"), true);
  assert.equal(runnerSource.includes("__tests__/mantine-static-subcomponents.test.js"), true);

  console.log("package-scripts.test.js ok");
})();
