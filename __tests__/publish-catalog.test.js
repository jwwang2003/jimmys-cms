/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Catalog shape and hashing.
 *
 * The ledger's correctness is a pair of properties, and the plan is explicit
 * that either alone can pass with a broken diff: identical input must produce
 * an identical artifact hash, and a generator version bump must change it.
 */
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: "commonjs", moduleResolution: "node" });
require("ts-node/register/transpile-only");

const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
    if (typeof request === "string" && request.startsWith("@/")) {
        request = path.join(process.cwd(), "src", request.slice(2));
    }
    return originalResolve.call(this, request, parent, isMain, options);
};

const { buildCatalog, CATALOG_FIELDS } = require("../src/lib/publish/catalog.ts");
const { assetContentHash, artifactHash, shortHash } = require("../src/lib/publish/content-hash.ts");
const { countryCodeFromName, geographyFromGeocodeResponse } = require("../src/lib/publish/geography.ts");

function asset(overrides) {
    const base = {
        uid: "a-photo",
        slug: "a-photo",
        title: "A Photo",
        takenAt: "2023-05-01",
        countryCode: "CN",
        regionCode: "CN-ZJ",
        city: "杭州市",
        place: "西湖区",
        camera: "Canon EOS 77D",
        width: 5000,
        height: 3333,
        lqip: "data:image/webp;base64,AAAA",
        tags: ["river", "street photography"],
        renditions: [
            { label: "avif-800", objectKey: "derived/photo/a-photo/800.avif" },
            { label: "webp-800", objectKey: "derived/photo/a-photo/800.webp" },
        ],
    };
    return { ...base, ...overrides };
}

function withHash(a) {
    return { ...a, contentHash: assetContentHash(a) };
}

(async () => {
    // --- content hash is stable and order-independent ------------------------
    {
        const a = asset();
        const reordered = asset({
            tags: ["street photography", "river"],
            renditions: [
                { label: "webp-800", objectKey: "derived/photo/a-photo/800.webp" },
                { label: "avif-800", objectKey: "derived/photo/a-photo/800.avif" },
            ],
        });
        assert.equal(
            assetContentHash(a),
            assetContentHash(reordered),
            "tag and rendition ordering must not affect the hash"
        );

        assert.notEqual(
            assetContentHash(a),
            assetContentHash(asset({ title: "Another Photo" })),
            "a semantic change must change the hash"
        );
        assert.notEqual(
            assetContentHash(a),
            assetContentHash(asset({ lqip: "data:image/webp;base64,BBBB" })),
            "the lqip ships in the catalog, so it is semantic"
        );
    }

    // --- artifact hash: the plan's paired property ---------------------------
    {
        const hashes = ["ccc", "aaa", "bbb"];
        assert.equal(
            artifactHash(hashes),
            artifactHash(["aaa", "bbb", "ccc"]),
            "input order must not affect the artifact hash"
        );
        assert.equal(artifactHash(hashes), artifactHash(hashes), "must be deterministic across calls");
        assert.notEqual(
            artifactHash(hashes, "1"),
            artifactHash(hashes, "2"),
            "a generator version bump must rebuild everything"
        );
        assert.notEqual(
            artifactHash(hashes),
            artifactHash([...hashes, "ddd"]),
            "an added asset must change the artifact hash"
        );
        assert.equal(shortHash("9f3a1c2b4d"), "9f3a1c");
    }

    // --- catalog shape -------------------------------------------------------
    {
        const assets = [
            withHash(asset({ uid: "b", slug: "b", takenAt: "2021-01-01", countryCode: "CA", regionCode: "CA-ON", camera: "iPhone 8", tags: ["building"] })),
            withHash(asset({ uid: "a", slug: "a", takenAt: "2023-05-01", countryCode: "CN", regionCode: "CN-ZJ", camera: "Canon EOS 77D", tags: ["river"] })),
            withHash(asset({ uid: "c", slug: "c", takenAt: null, countryCode: null, regionCode: null, camera: null, tags: [] })),
        ];
        const catalog = buildCatalog(assets);

        assert.deepEqual(catalog.fields, CATALOG_FIELDS);
        assert.equal(catalog.count, 3);
        assert.equal(catalog.rows.length, 3);

        // Rows are ordered by uid so the bytes depend only on content.
        assert.deepEqual(catalog.rows.map((r) => r[0]), ["a", "b", "c"]);

        // Dictionary columns are stored as integer indices into dict arrays.
        const countryIdx = CATALOG_FIELDS.indexOf("country");
        assert.equal(typeof catalog.rows[0][countryIdx], "number");
        assert.equal(catalog.dict.country[catalog.rows[0][countryIdx]], "CN");
        assert.equal(catalog.rows[2][countryIdx], null, "a missing country stays null, not interned");

        // Chronological order is precomputed; undated rows sort last.
        assert.deepEqual(
            catalog.order.chrono.map((i) => catalog.rows[i][0]),
            ["b", "a", "c"],
            "2021 before 2023, undated last"
        );

        // Postings are shipped, not rebuilt on the client.
        assert.deepEqual(catalog.postings.country.CN, [0]);
        assert.deepEqual(catalog.postings.country.CA, [1]);
        assert.deepEqual(catalog.postings.year["2021"], [1]);
        assert.deepEqual(catalog.postings.region["CA-ON"], [1]);
        assert.ok(catalog.postings.camera["iPhone 8"]);

        // Serialisation is stable: same input, same bytes.
        assert.equal(
            JSON.stringify(buildCatalog(assets)),
            JSON.stringify(buildCatalog([...assets].reverse())),
            "input order must not change the serialized catalog"
        );
    }

    // --- geography -----------------------------------------------------------
    {
        assert.equal(countryCodeFromName("中国"), "CN");
        assert.equal(countryCodeFromName("Panama"), "PA");
        assert.equal(countryCodeFromName("united states"), "US");
        assert.equal(countryCodeFromName("CA"), "CA", "an existing code passes through");
        assert.equal(countryCodeFromName(""), null);
        assert.equal(countryCodeFromName("Atlantis"), null);

        const geo = (components) => geographyFromGeocodeResponse(JSON.stringify({ results: [{ address_components: components }] }));

        // Where Google returns a real subdivision code, it passes through.
        assert.deepEqual(
            geo([
                { short_name: "ON", types: ["administrative_area_level_1"] },
                { short_name: "CA", types: ["country"] },
            ]),
            { countryCode: "CA", regionCode: "CA-ON" }
        );

        // Elsewhere it returns a name, in whichever language the response came
        // back in. The same province arrives under two spellings in this very
        // catalog, and both must collapse to one code or the facets fragment.
        for (const name of ["Shanghai", "Shang Hai Shi"]) {
            assert.equal(
                geo([
                    { short_name: name, types: ["administrative_area_level_1"] },
                    { short_name: "CN", types: ["country"] },
                ]).regionCode,
                "CN-SH",
                `${name} should resolve to CN-SH`
            );
        }
        for (const name of ["Guangdong Province", "Guang Dong Sheng"]) {
            assert.equal(
                geo([
                    { short_name: name, types: ["administrative_area_level_1"] },
                    { short_name: "CN", types: ["country"] },
                ]).regionCode,
                "CN-GD"
            );
        }
        for (const name of ["Lombardia", "Lombardy"]) {
            assert.equal(
                geo([
                    { short_name: name, types: ["administrative_area_level_1"] },
                    { short_name: "IT", types: ["country"] },
                ]).regionCode,
                "IT-25"
            );
        }
        // Diacritics and administrative nouns must not defeat the lookup.
        assert.equal(
            geo([
                { short_name: "Provincia de Panamá Oeste", types: ["administrative_area_level_1"] },
                { short_name: "PA", types: ["country"] },
            ]).regionCode,
            "PA-10"
        );

        // A city-level result has no province; the city resolves it only where
        // the mapping is a matter of record.
        assert.equal(
            geo([
                { long_name: "Guangzhou", types: ["locality"] },
                { short_name: "CN", types: ["country"] },
            ]).regionCode,
            "CN-GD"
        );

        // An unknown region must be null, never a fabricated code: a wrong
        // region files the asset under the wrong place, where a null merely
        // drops it from region filters.
        assert.deepEqual(
            geo([
                { short_name: "Some Unmapped Province", types: ["administrative_area_level_1"] },
                { short_name: "CN", types: ["country"] },
            ]),
            { countryCode: "CN", regionCode: null }
        );
        assert.equal(
            geo([
                { long_name: "Nowheresville", types: ["locality"] },
                { short_name: "CN", types: ["country"] },
            ]).regionCode,
            null
        );

        assert.deepEqual(geographyFromGeocodeResponse(null), { countryCode: null, regionCode: null });
        assert.deepEqual(geographyFromGeocodeResponse("not json"), { countryCode: null, regionCode: null });
    }

    console.log("publish-catalog.test.js ok");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
