/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Import the authored artwork data from glorialan.com into the CMS.
 *
 *   node scripts/import-site-artwork.js --dry-run
 *   node scripts/import-site-artwork.js
 *
 * The site is the only place these values exist: the artwork spreadsheet has no
 * title column, so the CMS is carrying filename-derived placeholders, and the
 * four series are hand-curated membership lists with no source in any sheet.
 * Publishing without this would downgrade what the site already shows.
 *
 * Assets are matched through `assets-master/manifest.json`, which records the
 * master path each site image was generated from. Matching on the leading
 * number would be wrong: the site numbers artworks in its own sequence, while
 * the CMS uses the spreadsheet's 作品编号, and the two diverge after the first
 * composite scan (site 005 is spreadsheet 010).
 */
require("./register-ts");

const fs = require("node:fs");
const path = require("node:path");

const SITE = "C:/Users/wjw/Documents/personal-workspace/glorialan.com";
const dryRun = process.argv.includes("--dry-run");

function parseArtworks(source) {
    const pattern =
        /\{\s*id: "([^"]+)",\s*src: "([^"]+)",\s*title: "([^"]+)",\s*year: "([^"]+)",\s*width: (\d+),\s*height: (\d+),?\s*(?:rotate: (\d+),?)?\s*\}/g;
    return [...source.matchAll(pattern)].map((m) => ({
        siteId: m[1],
        src: m[2],
        title: m[3],
        year: m[4],
        rotate: m[7] ? Number(m[7]) : null,
    }));
}

function parseSeries(source) {
    const blocks = [...source.matchAll(/\{\s*slug: "([^"]+)",\s*title: "([^"]+)",\s*description:\s*"((?:[^"\\]|\\.)*)",\s*artworkKeys: \[([^\]]*)\],?\s*\}/g)];
    return blocks.map((m) => ({
        slug: m[1],
        title: m[2],
        description: m[3].replace(/\\"/g, '"'),
        artworkKeys: [...m[4].matchAll(/"([^"]+)"/g)].map((k) => k[1]),
    }));
}

(async () => {
    const Database = require("better-sqlite3");
    const db = new Database(process.env.SQLITE_URL || "sqlite.db");

    const artworks = parseArtworks(fs.readFileSync(`${SITE}/app/art/artworks.ts`, "utf8"));
    const series = parseSeries(fs.readFileSync(`${SITE}/app/art/series.ts`, "utf8"));
    const manifest = JSON.parse(fs.readFileSync(`${SITE}/assets-master/manifest.json`, "utf8"));

    // site src -> master basename, via the manifest the optimizer wrote.
    const srcToMaster = new Map(
        manifest.entries.map((e) => [e.newSrc, path.posix.basename(e.oldSrc).toLowerCase()])
    );

    const cmsByBasename = new Map(
        db
            .prepare("select id, object_key, title, kind from media_assets where kind = 'artwork'")
            .all()
            .map((r) => [path.posix.basename(r.object_key).toLowerCase(), r])
    );

    console.log(`site artworks : ${artworks.length}`);
    console.log(`site series   : ${series.length}`);
    console.log(`cms artworks  : ${cmsByBasename.size}`);
    console.log(`mode          : ${dryRun ? "dry run" : "write"}\n`);

    const resolved = new Map(); // siteId -> cms asset
    const unmatched = [];
    for (const art of artworks) {
        const base = srcToMaster.get(art.src);
        const asset = base ? cmsByBasename.get(base) : null;
        if (!asset) {
            unmatched.push(art);
            continue;
        }
        resolved.set(art.siteId, { asset, art });
    }

    console.log(`matched: ${resolved.size}/${artworks.length}`);
    if (unmatched.length) {
        console.log("unmatched:");
        unmatched.forEach((a) => console.log(`  ${a.siteId}  ${a.src}`));
    }

    const titleChanges = [...resolved.values()].filter(({ asset, art }) => asset.title !== art.title);
    console.log(`\ntitles to update: ${titleChanges.length}`);
    titleChanges.slice(0, 8).forEach(({ asset, art }) =>
        console.log(`  ${JSON.stringify(asset.title).padEnd(40)} -> ${JSON.stringify(art.title)}`)
    );
    if (titleChanges.length > 8) console.log(`  ... and ${titleChanges.length - 8} more`);

    console.log(`\nseries:`);
    for (const s of series) {
        const members = s.artworkKeys.filter((k) => resolved.has(k));
        console.log(`  ${s.slug.padEnd(28)} ${members.length}/${s.artworkKeys.length} members resolved`);
        const missing = s.artworkKeys.filter((k) => !resolved.has(k));
        missing.forEach((k) => console.log(`      unresolved key: ${k}`));
    }

    if (dryRun) return;

    const now = Date.now();
    const write = db.transaction(() => {
        // Titles. The slug is left alone: it is the asset's public identity and
        // rendition keys are built from it.
        const setTitle = db.prepare("update media_assets set title = ?, updated_at = ? where id = ?");
        for (const { asset, art } of resolved.values()) {
            if (asset.title !== art.title) setTitle.run(art.title, now, asset.id);
        }

        // `year` and `rotate` have nowhere better to live than the asset's
        // metadata: year duplicates the spreadsheet date at lower precision,
        // and rotate is a display hint the site authored by hand.
        const getMeta = db.prepare("select metadata_json from media_assets where id = ?");
        const setMeta = db.prepare("update media_assets set metadata_json = ?, updated_at = ? where id = ?");
        for (const { asset, art } of resolved.values()) {
            let metadata = {};
            try {
                metadata = JSON.parse(getMeta.get(asset.id)?.metadata_json || "{}") || {};
            } catch {
                metadata = {};
            }
            metadata.artwork = {
                siteId: art.siteId,
                year: art.year,
                ...(art.rotate ? { rotate: art.rotate } : {}),
            };
            setMeta.run(JSON.stringify(metadata), now, asset.id);
        }

        // Series become collections. Rebuilt wholesale rather than merged, so a
        // removal on the site propagates instead of lingering.
        const findCollection = db.prepare("select id from collections where slug = ?");
        const insertCollection = db.prepare(
            "insert into collections (title, slug, description, kind, created_at, updated_at) values (?,?,?,?,?,?)"
        );
        const updateCollection = db.prepare(
            "update collections set title = ?, description = ?, updated_at = ? where id = ?"
        );
        const clearMembers = db.prepare("delete from collection_assets where collection_id = ?");
        const addMember = db.prepare(
            "insert into collection_assets (collection_id, asset_id, position, added_at) values (?,?,?,?)"
        );

        for (const s of series) {
            const existing = findCollection.get(s.slug);
            let collectionId;
            if (existing) {
                collectionId = existing.id;
                updateCollection.run(s.title, s.description, now, collectionId);
            } else {
                collectionId = Number(
                    insertCollection.run(s.title, s.slug, s.description, "series", now, now).lastInsertRowid
                );
            }
            clearMembers.run(collectionId);
            s.artworkKeys.forEach((key, index) => {
                const hit = resolved.get(key);
                if (hit) addMember.run(collectionId, hit.asset.id, index, now);
            });
        }
    });
    write();

    console.log(`\nwrote ${titleChanges.length} titles, ${series.length} series`);
    db.close();
})().catch((error) => {
    console.error("import failed:", error);
    process.exitCode = 1;
});
