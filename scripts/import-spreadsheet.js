/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Apply a metadata spreadsheet onto assets that already exist (plan §2).
 *
 *   node scripts/import-spreadsheet.js --file=data/photography_v1_0.xlsx \
 *     --key-prefix=masters/originals/photography/ --dry-run
 *
 * `--key-prefix` is not optional in practice: sheet ids restart at 1 for each
 * medium, so photography 001 and artwork 001 are different works that collide
 * on every id-based lookup. Scoping the match to one subtree is what keeps a
 * photography row off an artwork asset.
 */
require("./register-ts");

const fs = require("node:fs");

const arg = (name, fallback) => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const file = arg("file");
const keyPrefix = arg("key-prefix");
const dryRun = flag("dry-run");

if (!file) {
    console.error("usage: node scripts/import-spreadsheet.js --file=<xlsx> [--key-prefix=<prefix>] [--dry-run]");
    process.exit(2);
}

(async () => {
    const { db } = require("../src/db/index.ts");
    const { importMediaSpreadsheetIntoDb } = require("../src/lib/media/spreadsheet-import.ts");

    console.log(`file      : ${file}`);
    console.log(`key prefix: ${keyPrefix || "(none — matches across all media)"}`);
    console.log(`mode      : ${dryRun ? "dry run" : "write"}\n`);

    const summary = await importMediaSpreadsheetIntoDb(db, {
        fileName: file,
        bytes: fs.readFileSync(file),
        keyPrefix,
        dryRun,
    });

    const { unresolved, ...counts } = summary;
    console.log(JSON.stringify(counts, null, 2));

    if (unresolved.length) {
        console.log(`\n${unresolved.length} unresolved row(s):`);
        for (const row of unresolved) {
            console.log(`  id ${row.externalId}: ${row.reason}`);
            (row.candidates || []).forEach((c) => console.log(`      candidate: ${c}`));
        }
        process.exitCode = 1;
    }
})().catch((error) => {
    console.error("import failed:", error);
    process.exitCode = 1;
});
