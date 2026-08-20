/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Build and publish the catalog artifacts (plan §6).
 *
 *   node scripts/publish.js --dry-run              # build + diff, write nothing
 *   node scripts/publish.js                        # publish changed artifacts
 *   node scripts/publish.js --include-drafts       # include unpublished assets
 *   node scripts/publish.js --revalidate           # notify even when nothing was written
 *   node scripts/publish.js --no-revalidate        # never notify
 *
 * A publish that wrote objects notifies the site's /api/revalidate by itself
 * when REVALIDATE_ENDPOINT and REVALIDATE_SECRET are set — otherwise the site
 * serves the old manifest until its hourly backstop. A run that wrote nothing
 * skips the call (the site's cache is already correct); --revalidate forces it
 * anyway, for when a previous notification was missed.
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
const forceRevalidate = flag("revalidate");
const skipRevalidate = flag("no-revalidate");
const outPath = arg("out");

(async () => {
    const { collectPublishableAssets, storeContentHashes } = require("../src/lib/publish/collect.ts");
    const { publish, notifyRevalidate } = require("../src/lib/publish/publish.ts");
    const { GENERATOR_VERSION } = require("../src/lib/publish/content-hash.ts");
    const { buildCatalog } = require("../src/lib/publish/catalog.ts");

    const { materializeGeography, collectSeries } = require("../src/lib/publish/collect.ts");
    if (!dryRun) {
        const geo = materializeGeography();
        console.log(`geography : ${geo.withCountry} country, ${geo.withRegion} region materialized
`);
    }

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

    const series = collectSeries();
    const byKind = assets.reduce((acc, a) => {
        acc[a.kind] = (acc[a.kind] || 0) + 1;
        return acc;
    }, {});
    console.log(`  by kind         : ${Object.entries(byKind).map(([k, v]) => `${k}=${v}`).join(" ")}`);
    console.log(`  series          : ${series.length}\n`);

    const summary = await publish({ assets, series, dryRun, force });

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

    if (!dryRun && !skipRevalidate && (summary.objectsWritten > 0 || forceRevalidate)) {
        const endpoint = process.env.REVALIDATE_ENDPOINT;
        const secret = process.env.REVALIDATE_SECRET;
        if (!endpoint || !secret) {
            // Loud, not fatal: the artifacts are already live, but the site
            // will keep serving the old manifest until its hourly backstop.
            console.warn("\nrevalidate SKIPPED: REVALIDATE_ENDPOINT / REVALIDATE_SECRET not set — site stays stale up to 1h");
        } else {
            const result = await notifyRevalidate({ endpoint, secret, ids: assets.map((a) => a.uid) });
            console.log(`\nrevalidate: ${result.ok ? "ok" : `FAILED — ${result.error || result.status} (site refreshes on its hourly backstop)`}`);
        }
    } else if (!dryRun && !skipRevalidate) {
        console.log("\nrevalidate: skipped (no objects written; --revalidate to force)");
    }
})().catch((error) => {
    console.error("publish failed:", error);
    process.exitCode = 1;
});
