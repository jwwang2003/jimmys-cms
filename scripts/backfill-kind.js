/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Classify every asset as photography, artwork or support.
 *
 *   node scripts/backfill-kind.js --dry-run
 *   node scripts/backfill-kind.js
 *
 * Two independent signals are available and they are checked against each
 * other rather than one being trusted blindly:
 *
 *   path  — which master subtree the object sits in
 *   sheet — 摄影信息 (camera) appears only in the photography spreadsheet,
 *           主要绘画工具 (tool) only in the artwork one
 *
 * The path decides, because it covers assets with no spreadsheet row at all.
 * The sheet is the cross-check: a disagreement means either a file is filed in
 * the wrong tree or a row matched the wrong asset, and both are worth seeing.
 */
require("./register-ts");

const flag = (name) => process.argv.includes(`--${name}`);
const dryRun = flag("dry-run");

/** Subtrees that are site chrome rather than catalogued works. */
const SUPPORT_PATTERNS = [
    "/artwork-jpg/series-covers/",
    "/artwork-jpg/architecture-references/",
];

function kindFromPath(objectKey) {
    if (SUPPORT_PATTERNS.some((p) => objectKey.includes(p))) return "support";
    if (objectKey.includes("/photography/")) return "photography";
    if (objectKey.includes("/artwork-jpg/")) return "artwork";
    return "support";
}

function kindFromSheet(metadataJson) {
    try {
        const sheet = JSON.parse(metadataJson || "{}").spreadsheet;
        if (!sheet) return null;
        if (sheet.tool) return "artwork";
        if (sheet.camera) return "photography";
    } catch {
        // Unparseable metadata simply yields no signal.
    }
    return null;
}

(async () => {
    const Database = require("better-sqlite3");
    const db = new Database(process.env.SQLITE_URL || "sqlite.db");

    const rows = db.prepare("select id, object_key, metadata_json, kind from media_assets").all();
    const counts = {};
    const conflicts = [];
    const updates = [];

    for (const row of rows) {
        const fromPath = kindFromPath(row.object_key);
        const fromSheet = kindFromSheet(row.metadata_json);

        // Only a real disagreement counts. A support file has no sheet row, and
        // orphaned masters have neither, so a null signal is not a conflict.
        if (fromSheet && fromSheet !== fromPath && fromPath !== "support") {
            conflicts.push({ id: row.id, key: row.object_key, fromPath, fromSheet });
        }

        counts[fromPath] = (counts[fromPath] || 0) + 1;
        if (row.kind !== fromPath) updates.push({ id: row.id, kind: fromPath });
    }

    console.log(`assets      : ${rows.length}`);
    console.log(`mode        : ${dryRun ? "dry run" : "write"}\n`);
    for (const [k, v] of Object.entries(counts).sort()) console.log(`  ${k.padEnd(12)} ${v}`);
    console.log(`\nrows to change: ${updates.length}`);

    if (conflicts.length) {
        console.log(`\n${conflicts.length} path/spreadsheet disagreement(s):`);
        conflicts.slice(0, 20).forEach((c) =>
            console.log(`  asset ${c.id}: path=${c.fromPath} sheet=${c.fromSheet}  ${c.key}`)
        );
    } else {
        console.log("\nno path/spreadsheet disagreements");
    }

    if (!dryRun && updates.length) {
        const stmt = db.prepare("update media_assets set kind = ?, updated_at = ? where id = ?");
        const tx = db.transaction(() => {
            for (const u of updates) stmt.run(u.kind, Date.now(), u.id);
        });
        tx();
        console.log(`\nupdated ${updates.length} rows`);
    }

    db.close();
    if (conflicts.length) process.exitCode = 1;
})().catch((error) => {
    console.error("backfill failed:", error);
    process.exitCode = 1;
});
