/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * The bucket registry resolves credentials per alias.
 *
 * This is a security boundary, not a convenience: the media bucket is public
 * and takes almost all the writes, while the masters bucket holds the only copy
 * of the original pixels. A token scoped to media must not be able to reach
 * masters, so the two aliases must never share a client.
 */
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: "commonjs", moduleResolution: "node" });

const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

// s3.ts reads process.env at module load, so the environment has to be in place
// before it is required.
process.env.AWS_REGION = "us-east-2";
process.env.S3_BUCKET = "legacy-default-bucket";
process.env.R2_ACCOUNT_ID = "a".repeat(32);
process.env.R2_ACCESS_KEY_ID = "SHARED_KEY";
process.env.R2_SECRET_ACCESS_KEY = "SHARED_SECRET";
process.env.R2_BUCKET_MASTERS = "test-masters";
process.env.R2_BUCKET_MEDIA = "test-media";
process.env.R2_ACCESS_KEY_ID_MEDIA = "MEDIA_ONLY_KEY";
process.env.R2_SECRET_ACCESS_KEY_MEDIA = "MEDIA_ONLY_SECRET";
process.env.R2_CDN_BASE_URL_MEDIA = "https://media.example.com";

require("ts-node/register/transpile-only");

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
    if (typeof request === "string" && request.startsWith("@/")) {
        request = path.join(process.cwd(), "src", request.slice(2));
    }
    return originalResolve.call(this, request, parent, isMain, options);
};

const { buckets, getS3 } = require("../src/lib/s3.ts");

(async () => {
    // --- registry ----------------------------------------------------------
    assert.equal(buckets.masters.name, "test-masters");
    assert.equal(buckets.media.name, "test-media");

    // Both R2 buckets inherit the account endpoint derived from the account id.
    const expectedEndpoint = `https://${"a".repeat(32)}.r2.cloudflarestorage.com`;
    assert.equal(buckets.masters.endpoint, expectedEndpoint);
    assert.equal(buckets.media.endpoint, expectedEndpoint);
    assert.equal(buckets.masters.region, "auto");

    // --- credentials are per alias -----------------------------------------
    assert.equal(buckets.masters.credentials.accessKeyId, "SHARED_KEY");
    assert.equal(
        buckets.media.credentials.accessKeyId,
        "MEDIA_ONLY_KEY",
        "a per-alias key must override the shared one"
    );

    // --- and the clients are genuinely distinct -----------------------------
    const masters = getS3("masters");
    const media = getS3("media");

    assert.notEqual(
        masters.client,
        media.client,
        "aliases with different credentials must not share a client"
    );

    const mastersCreds = await masters.client.config.credentials();
    const mediaCreds = await media.client.config.credentials();
    assert.equal(mastersCreds.accessKeyId, "SHARED_KEY");
    assert.equal(
        mediaCreds.accessKeyId,
        "MEDIA_ONLY_KEY",
        "the media client must not be handed the masters credential"
    );

    // Both R2 aliases share region "auto" and one endpoint, so a cache keyed on
    // region alone would return the same client for both. That is the failure
    // this asserts against.
    assert.equal(masters.region, media.region);
    assert.equal(masters.endpoint, media.endpoint);

    // --- an alias without its own key falls back to the shared one ----------
    assert.equal(buckets.masters.credentials.secretAccessKey, "SHARED_SECRET");

    // --- CDN base URL is per alias -----------------------------------------
    assert.equal(media.cdnBaseUrl, "https://media.example.com");
    assert.equal(masters.cdnBaseUrl, "", "the private bucket is served from nowhere");

    // --- the legacy AWS default alias is untouched by any of this -----------
    const fallback = getS3("default");
    assert.equal(fallback.bucket, "legacy-default-bucket");
    assert.equal(fallback.region, "us-east-2");
    assert.equal(fallback.endpoint, "", "the AWS default takes no custom endpoint");

    console.log("s3-buckets.test.js ok");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
