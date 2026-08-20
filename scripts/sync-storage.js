/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Reconcile a bucket prefix into `storage_objects` (and create the matching
 * `media_assets` rows). See DOCUMENTATION/cms-plan.md §3.
 *
 *   node scripts/sync-storage.js --storage=masters --prefix=masters/originals
 *   node scripts/sync-storage.js --storage=masters --prefix=masters/ --dry-run
 *
 * Flags:
 *   --storage=<alias>   storage_locations id (default: masters)
 *   --prefix=<key>      literal key prefix to walk
 *   --limit=<n>         stop after n objects
 *   --exif              read each image in full to extract EXIF (slow: it
 *                       downloads every byte). Off by default.
 *   --no-assets         record objects only, do not create media_assets
 *   --dry-run           list what would be synced, write nothing
 */
require("./register-ts");

const arg = (name, fallback) => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const storageId = arg("storage", "masters");
const prefix = arg("prefix", "masters/");
const limit = arg("limit") ? Number(arg("limit")) : undefined;
const dryRun = flag("dry-run");
const withExif = flag("exif");
const noAssets = flag("no-assets");

(async () => {
    const { getS3 } = require("../src/lib/s3.ts");
    const { ListObjectsV2Command } = require("@aws-sdk/client-s3");

    const { bucket, endpoint, cdnBaseUrl } = getS3(storageId);
    console.log(`storage : ${storageId}`);
    console.log(`bucket  : ${bucket}`);
    console.log(`endpoint: ${endpoint || "(aws)"}`);
    console.log(`cdn     : ${cdnBaseUrl || "-"}`);
    console.log(`prefix  : ${prefix}`);
    console.log(`mode    : ${dryRun ? "dry run" : "write"}${withExif ? " + exif" : ""}\n`);

    if (dryRun) {
        const { client } = getS3(storageId);
        let token;
        let count = 0;
        let bytes = 0;
        const sample = [];
        do {
            const res = await client.send(
                new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token })
            );
            for (const o of res.Contents || []) {
                if (o.Key.endsWith("/")) continue;
                count += 1;
                bytes += Number(o.Size || 0);
                if (sample.length < 5) sample.push(o.Key);
            }
            token = res.IsTruncated ? res.NextContinuationToken : undefined;
        } while (token);
        sample.forEach((k) => console.log("  " + k));
        console.log(`\nwould sync ${count} objects, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
        return;
    }

    // Importing the db module runs migrations and bootstrap, so it must come
    // after the dry-run branch to keep --dry-run genuinely read-only.
    const { syncS3Prefix } = require("../src/lib/media/service.ts");

    const started = Date.now();
    const summary = await syncS3Prefix({
        storageId,
        rawPrefix: prefix,
        limit,
        skipExif: !withExif,
        createAssets: !noAssets,
        onProgress: (done, key) => {
            if (done % 25 === 0 || done === 1) console.log(`  ${done} … ${key}`);
        },
    });

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`\ndone in ${elapsed}s`);
    console.log(JSON.stringify(summary, null, 2));
})().catch((error) => {
    console.error("sync failed:", error);
    process.exitCode = 1;
});
