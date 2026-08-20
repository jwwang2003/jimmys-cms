/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Lets a plain `node scripts/*.js` entry point require the app's TypeScript
 * modules, which address each other through the `@/*` tsconfig path alias.
 *
 * ts-node does not read `paths` (that is a type-checking concern, and these run
 * transpile-only), and Next's bundler is not involved outside a request. The
 * `__tests__` suites solve this by patching `Module._resolveFilename` inline;
 * this is the same trick, in one place.
 */
require("dotenv").config();

const Module = require("node:module");
const path = require("node:path");

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: "commonjs", moduleResolution: "node" });
require("ts-node/register/transpile-only");

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (typeof request === "string" && request.startsWith("@/")) {
        request = path.join(process.cwd(), "src", request.slice(2));
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
};
