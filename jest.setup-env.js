/* eslint-disable @typescript-eslint/no-require-imports */
// Load environment variables for Jest tests with two modes:
// - dev mode: load .env (base) then .env.development
// - prod mode: load .env (base) then .env.production
// Select mode via JEST_ENV=dev|prod (defaults to dev)
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const root = process.cwd();
const mode = (process.env.JEST_ENV || process.env.APP_ENV || "dev").toLowerCase();

// Always load base first so env-specific values can override
const loadIfExists = (p) => {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p, override: true });
    return true;
  }
  return false;
};

// Base
loadIfExists(path.join(root, ".env"));

// Mode-specific
if (mode === "prod" || mode === "production") {
  loadIfExists(path.join(root, ".env.production"));
} else {
  loadIfExists(path.join(root, ".env.development"));
}

// Allow AWS SDK to load credentials/region from shared config (~/.aws/*)
process.env.AWS_SDK_LOAD_CONFIG = process.env.AWS_SDK_LOAD_CONFIG || "1";
