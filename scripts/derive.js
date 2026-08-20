/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Generate derivatives for the catalogued masters (plan §4).
 *
 *   node scripts/derive.js --measure                  # encode + measure, write nothing
 *   node scripts/derive.js --limit=5                  # derive and upload 5 assets
 *   node scripts/derive.js --apply-dimensions         # accept a reviewed diff
 *
 * Flags:
 *   --measure            encode only: no uploads, no database writes. Used to
 *                        produce the measured-vs-declared dimension diff that
 *                        the plan requires be reviewed before it is applied.
 *   --limit=<n>          process at most n assets
 *   --filter=<substr>    only assets whose object key contains this
 *   --apply-dimensions   write measured dimensions even where they contradict
 *                        the declared ones
 *   --report=<path>      write the full JSON summary here
 */
require("./register-ts");

const fs = require("node:fs");
const path = require("node:path");

const arg = (name, fallback) => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const measureOnly = flag("measure");
const applyDimensions = flag("apply-dimensions");
const limit = arg("limit") ? Number(arg("limit")) : undefined;
const filter = arg("filter");
const reportPath = arg("report");

// Declared dimensions come from the master manifest the site's optimizer wrote.
const MANIFEST =
    "C:/Users/wjw/Documents/personal-workspace/glorialan.com/assets-master/manifest.json";

function loadDeclaredDimensions() {
    if (!fs.existsSync(MANIFEST)) return new Map();
    const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
    const map = new Map();
    for (const entry of manifest.entries || []) {
        if (!entry.oldSrc || !entry.masterWidth) continue;
        // oldSrc is a public path; key the map on the basename, which is what
        // survives into the R2 object key.
        map.set(path.posix.basename(entry.oldSrc).toLowerCase(), {
            width: entry.masterWidth,
            height: entry.masterHeight,
        });
    }
    return map;
}

(async () => {
    const Database = require("better-sqlite3");
    const { runDerive } = require("../src/lib/media/derive-run.ts");

    const sqlitePath = process.env.SQLITE_URL || "sqlite.db";
    const raw = new Database(sqlitePath, { readonly: true });
    let assets = raw
        .prepare(
            `select id, slug, object_key, width, height
             from media_assets
             where media_type = 'image' and lifecycle_status = 'active'
             order by id asc`
        )
        .all();
    raw.close();

    if (filter) assets = assets.filter((a) => a.object_key.includes(filter));
    if (limit) assets = assets.slice(0, limit);

    const declared = loadDeclaredDimensions();

    const targets = assets.map((a) => {
        const base = path.posix.basename(a.object_key).toLowerCase();
        const d = declared.get(base);
        return {
            assetId: a.id,
            objectKey: a.object_key,
            uid: a.slug,
            declaredWidth: d?.width ?? a.width ?? null,
            declaredHeight: d?.height ?? a.height ?? null,
        };
    });

    console.log(`assets   : ${targets.length}`);
    console.log(`declared : ${targets.filter((t) => t.declaredWidth).length} have declared dimensions`);
    console.log(`mode     : ${measureOnly ? "measure only (no uploads, no writes)" : "derive + upload"}`);
    console.log(`dims     : ${applyDimensions ? "apply even on conflict" : "skip on conflict, pending review"}\n`);

    const started = Date.now();
    const summary = await runDerive({
        targets,
        measureOnly,
        applyDimensions,
        onProgress: (done, total, target) => {
            if (done % 10 === 0 || done === 1 || done === total) {
                console.log(`  ${done}/${total} … ${path.posix.basename(target.objectKey)}`);
            }
        },
    });

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`\ndone in ${elapsed}s`);
    console.log(
        JSON.stringify(
            {
                processed: summary.processed,
                failed: summary.failed,
                renditionsWritten: summary.renditionsWritten,
                objectsUploaded: summary.objectsUploaded,
                dimensionsApplied: summary.dimensionsApplied,
                dimensionDiffs: summary.dimensionDiffs.length,
            },
            null,
            2
        )
    );

    if (summary.dimensionDiffs.length) {
        console.log(`\n${summary.dimensionDiffs.length} dimension mismatch(es) — REVIEW BEFORE APPLYING:`);
        for (const d of summary.dimensionDiffs.slice(0, 20)) {
            console.log(
                `  asset ${d.assetId} ${path.posix.basename(d.objectKey)}: ` +
                    `declared ${d.declared.width}x${d.declared.height} ` +
                    `measured ${d.measured.width}x${d.measured.height}` +
                    (d.transposed ? "  (transposed — EXIF orientation)" : "")
            );
        }
        if (summary.dimensionDiffs.length > 20) {
            console.log(`  ... and ${summary.dimensionDiffs.length - 20} more`);
        }
    }

    const failures = summary.outcomes.filter((o) => o.error);
    if (failures.length) {
        console.log(`\n${failures.length} failure(s):`);
        failures.slice(0, 20).forEach((f) => console.log(`  asset ${f.assetId} ${f.objectKey}: ${f.error}`));
    }

    if (reportPath) {
        fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));
        console.log(`\nfull report -> ${reportPath}`);
    }

    if (summary.failed) process.exitCode = 1;
})().catch((error) => {
    console.error("derive failed:", error);
    process.exitCode = 1;
});
