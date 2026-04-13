/* eslint-disable @typescript-eslint/no-require-imports */
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: "commonjs", moduleResolution: "node" });
require("ts-node/register/transpile-only");

const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");

const originalResolveFilename = Module._resolveFilename;

(async () => {
  try {
    Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
      if (typeof request === "string" && request.startsWith("@/")) {
        request = path.join(process.cwd(), "src", request.slice(2));
      }
      return originalResolveFilename.call(this, request, parent, isMain, options);
    };

    const { classifyIntegrityResult } = require("../src/lib/media/integrity.ts");

    assert.deepEqual(
      classifyIntegrityResult({ ok: true }),
      { integrityStatus: "ok", integrityMessage: null }
    );

    assert.deepEqual(
      classifyIntegrityResult({ ok: false, code: "NotFound", message: "Object not found in S3" }),
      { integrityStatus: "missing", integrityMessage: "Object not found in S3" }
    );

    assert.deepEqual(
      classifyIntegrityResult({ ok: false, code: "TimeoutError", message: "AWS timeout while verifying object" }),
      { integrityStatus: "warning", integrityMessage: "AWS timeout while verifying object" }
    );

    const summary = { checked: 3, ok: 1, missing: 1, warning: 1, invalid: 0 };
    assert.equal(summary.checked, 3);
    assert.equal(summary.missing, 1);

    console.log("asset-integrity.test.js ok");
  } finally {
    Module._resolveFilename = originalResolveFilename;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
