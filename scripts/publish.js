/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Build and publish the catalog artifacts (plan §6).
 *
 *   node scripts/publish.js --dry-run              # build + diff, write nothing
 *   node scripts/publish.js                        # publish changed artifacts
 *   node scripts/publish.js --include-drafts       # include unpublished assets
 *   node scripts/publish.js --revalidate           # notify the site afterwards
 *
 * Publishing is a diff, not a rewrite: artifact hashes are recomputed, compared
 * against the build_state ledger, and only mismatches are written. A second run
 * with no edits must emit zero objects.
 */
require("./register-ts");

const fs = require("node:fs");

const arg = (name, fallback) => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const dryRun = flag("dry-run");
const includeDrafts = flag("include-drafts");
const force = flag("force");
const doRevalidate = flag("revalidate");
const outPath = arg("out");

(async () => {
    const { collectPublishableAssets, storeContentHashes } = require("../src/lib/publish/collect.ts");
    const { publish, notifyRevalidate } = require("../src/lib/publish/publish.ts");
    const { GENERATOR_VERSION } = require("../src/lib/publish/content-hash.ts");
    const { buildCatalog } = require("../src/lib/publish/catalog.ts");

    const assets = collectPublishableAssets({ includeDrafts });
    console.log(`generator : v${GENERATOR_VERSION}`);
    console.log(`assets    : ${assets.length}${includeDrafts ? " (including drafts)" : " (published only)"}`);
    console.log(`mode      : ${dryRun ? "dry run" : "publish"}${force ? " (forced)" : ""}\n`);

    if (assets.length === 0) {
        console.log("Nothing to publish. Assets must be status='published', or pass --include-drafts.");
        return;
    }

    const withRenditions = assets.filter((a) => a.renditions.length > 0);
    const withGeography = assets.filter((a) => a.countryCode);
    const withLqip = assets.filter((a) => a.lqip);
    console.log(`  with renditions : ${withRenditions.length}/${assets.length}`);
    console.log(`  with country    : ${withGeography.length}/${assets.length}`);
    console.log(`  with lqip       : ${withLqip.length}/${assets.length}\n`);

    if (!dryRun) storeContentHashes(assets);

    const summary = await publish({ assets, dryRun, force });

    for (const artifact of summary.artifacts) {
        const size = (artifact.sizeBytes / 1024).toFixed(1);
        console.log(
            `  ${artifact.artifact.padEnd(9)} ${artifact.reason.padEnd(13)} ` +
                `${artifact.written ? "WROTE" : "skip "} ${String(size).padStart(8)} KB  ${artifact.objectKey}`
        );
    }
    console.log(`\nobjects written: ${summary.objectsWritten}`);

    if (outPath) {
        const catalog = buildCatalog(assets);
        fs.writeFileSync(outPath, JSON.stringify(catalog, null, 2));
        console.log(`catalog -> ${outPath}`);
    }

    if (doRevalidate && !dryRun) {
        const endpoint = process.env.REVALIDATE_ENDPOINT;
        const secret = process.env.REVALIDATE_SECRET;
        if (!endpoint || !secret) {
            console.log("\nrevalidate skipped: REVALIDATE_ENDPOINT / REVALIDATE_SECRET not set");
        } else {
            const result = await notifyRevalidate({ endpoint, secret, ids: assets.map((a) => a.uid) });
            console.log(`\nrevalidate: ${result.ok ? "ok" : `failed — ${result.error || result.status}`}`);
        }
    }
})().catch((error) => {
    console.error("publish failed:", error);
    process.exitCode = 1;
});
