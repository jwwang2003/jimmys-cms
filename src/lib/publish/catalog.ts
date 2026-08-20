import type { HashableAsset } from "./content-hash";

/**
 * Columnar catalog builder (photo-platform-plan.md §8.1).
 *
 * Columnar rather than an array of objects: the same data, materially smaller,
 * and directly indexable. Small-cardinality columns are interned into
 * dictionaries and stored as integer indices, chronological order is
 * precomputed, and the facet postings are shipped rather than rebuilt on the
 * client — the generator has already read every row, so making the browser
 * redo that work is pure waste.
 *
 * Photography and artwork are published as separate artifacts because they are
 * separate pages with genuinely different shapes. A painting has no country,
 * region or camera; a photograph has no series. Merging them would ship every
 * `/art` visitor a region posting index they never read, and force both halves
 * to carry the other's empty columns.
 */

export type AssetKind = "photography" | "artwork" | "support";

/** Column order is part of the wire contract; readers index by position. */
export const PHOTO_FIELDS = [
    "uid",
    "slug",
    "takenAt",
    "country",
    "region",
    "city",
    "place",
    "title",
    "camera",
    "w",
    "h",
    "lqip",
    "tags",
] as const;

export const ARTWORK_FIELDS = [
    "uid",
    "slug",
    "takenAt",
    "year",
    "title",
    "w",
    "h",
    "lqip",
    "tags",
    "series",
    "rotate",
] as const;

/** Back-compat alias: the photography set was the original single catalog. */
export const CATALOG_FIELDS = PHOTO_FIELDS;

export type CatalogAsset = HashableAsset & {
    contentHash: string;
    kind: AssetKind;
    /** Artwork only. */
    year?: string | null;
    series?: string[];
    rotate?: number | null;
};

export type Catalog = {
    v: number;
    kind: AssetKind;
    fields: readonly string[];
    dict: Record<string, string[]>;
    rows: unknown[][];
    order: { chrono: number[] };
    postings: Record<string, Record<string, number[]>>;
    count: number;
};

class Interner {
    private readonly values: string[] = [];
    private readonly index = new Map<string, number>();

    intern(value: string) {
        const existing = this.index.get(value);
        if (existing !== undefined) return existing;
        const id = this.values.length;
        this.values.push(value);
        this.index.set(value, id);
        return id;
    }

    toArray() {
        return this.values;
    }
}

function pushPosting(target: Record<string, Record<string, number[]>>, group: string, key: string, rowIndex: number) {
    const bucket = (target[group] ??= {});
    (bucket[key] ??= []).push(rowIndex);
}

/**
 * Chronological order, precomputed so the client never sorts. Every result set
 * is a filtered projection of this, which also keeps order stable as filters
 * change. Undated rows sort last, ties broken by uid so the result is total.
 */
function chronoOrder(ordered: CatalogAsset[]) {
    return ordered
        .map((asset, index) => ({ index, takenAt: asset.takenAt, uid: asset.uid }))
        .sort((a, b) => {
            if (a.takenAt && b.takenAt) {
                if (a.takenAt !== b.takenAt) return a.takenAt < b.takenAt ? -1 : 1;
            } else if (a.takenAt) return -1;
            else if (b.takenAt) return 1;
            return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
        })
        .map((entry) => entry.index);
}

function finalize(catalog: Catalog): Catalog {
    // Sort every posting list so the serialization is order-independent.
    for (const group of Object.values(catalog.postings)) {
        for (const key of Object.keys(group)) group[key].sort((a, b) => a - b);
    }
    return catalog;
}

/**
 * Build a catalog for one medium.
 *
 * Rows are emitted sorted by uid so the serialized bytes depend only on
 * content. If row order tracked a database query's whim, two runs over
 * identical data would differ and the publish diff would rewrite the catalog
 * every time.
 */
export function buildCatalog(assets: CatalogAsset[], kind: AssetKind = "photography"): Catalog {
    const ordered = [...assets].sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
    return kind === "artwork" ? buildArtworkCatalog(ordered) : buildPhotoCatalog(ordered);
}

function buildPhotoCatalog(ordered: CatalogAsset[]): Catalog {
    const country = new Interner();
    const region = new Interner();
    const city = new Interner();
    const place = new Interner();
    const camera = new Interner();
    const tagsInterner = new Interner();

    const rows: unknown[][] = [];
    const postings: Catalog["postings"] = { country: {}, region: {}, year: {}, tag: {}, camera: {} };

    ordered.forEach((asset, rowIndex) => {
        const tagIds = [...asset.tags].sort().map((tag) => tagsInterner.intern(tag));

        rows.push([
            asset.uid,
            asset.slug,
            asset.takenAt,
            asset.countryCode ? country.intern(asset.countryCode) : null,
            asset.regionCode ? region.intern(asset.regionCode) : null,
            asset.city ? city.intern(asset.city) : null,
            asset.place ? place.intern(asset.place) : null,
            asset.title,
            asset.camera ? camera.intern(asset.camera) : null,
            asset.width,
            asset.height,
            asset.lqip,
            tagIds,
        ]);

        if (asset.countryCode) pushPosting(postings, "country", asset.countryCode, rowIndex);
        if (asset.regionCode) pushPosting(postings, "region", asset.regionCode, rowIndex);
        if (asset.camera) pushPosting(postings, "camera", asset.camera, rowIndex);
        if (asset.takenAt) pushPosting(postings, "year", asset.takenAt.slice(0, 4), rowIndex);
        // Tag postings key on the interned id, matching §8.1's `"tag": { "3": … }`.
        for (const tagId of tagIds) pushPosting(postings, "tag", String(tagId), rowIndex);
    });

    return finalize({
        v: 1,
        kind: "photography",
        fields: PHOTO_FIELDS,
        dict: {
            country: country.toArray(),
            region: region.toArray(),
            city: city.toArray(),
            place: place.toArray(),
            camera: camera.toArray(),
            tags: tagsInterner.toArray(),
        },
        rows,
        order: { chrono: chronoOrder(ordered) },
        postings,
        count: ordered.length,
    });
}

function buildArtworkCatalog(ordered: CatalogAsset[]): Catalog {
    const tagsInterner = new Interner();
    const seriesInterner = new Interner();

    const rows: unknown[][] = [];
    const postings: Catalog["postings"] = { year: {}, tag: {}, series: {} };

    ordered.forEach((asset, rowIndex) => {
        const tagIds = [...asset.tags].sort().map((tag) => tagsInterner.intern(tag));
        const seriesIds = [...(asset.series ?? [])].sort().map((slug) => seriesInterner.intern(slug));

        rows.push([
            asset.uid,
            asset.slug,
            asset.takenAt,
            asset.year ?? null,
            asset.title,
            asset.width,
            asset.height,
            asset.lqip,
            tagIds,
            seriesIds,
            asset.rotate ?? null,
        ]);

        // Artwork is faceted by year rather than by full date: the site shows a
        // year, and several works carry only that much precision.
        const year = asset.year || (asset.takenAt ? asset.takenAt.slice(0, 4) : null);
        if (year) pushPosting(postings, "year", year, rowIndex);
        for (const tagId of tagIds) pushPosting(postings, "tag", String(tagId), rowIndex);
        // Series postings key on the slug, which is what the site routes on.
        for (const slug of asset.series ?? []) pushPosting(postings, "series", slug, rowIndex);
    });

    return finalize({
        v: 1,
        kind: "artwork",
        fields: ARTWORK_FIELDS,
        dict: { tags: tagsInterner.toArray(), series: seriesInterner.toArray() },
        rows,
        order: { chrono: chronoOrder(ordered) },
        postings,
        count: ordered.length,
    });
}

export type SeriesEntry = {
    slug: string;
    title: string;
    description: string;
    /** Member uids, in curated order. */
    artworks: string[];
};

export type Manifest = {
    v: number;
    /** Content-hashed catalog filenames, one per medium. */
    catalogs: Record<string, string>;
    counts: Record<string, number>;
    series: SeriesEntry[];
    generated: string;
    generatorVersion: string;
    /**
     * Retained from the original contract. Sharding is a size escape hatch,
     * distinct from the per-medium split, which is about shape.
     */
    shards: null;
};

/**
 * The manifest is the one mutable object, so it is deliberately tiny and served
 * no-cache. It carries a timestamp because it is not content-addressed; the
 * catalogs it points at are.
 *
 * Series live here rather than in the artwork catalog: they are a handful of
 * curated lists that the landing page needs before it has any artwork rows, and
 * putting them behind the catalog fetch would serialise two round trips.
 */
export function buildManifest(input: {
    catalogKeys: Record<string, string>;
    counts: Record<string, number>;
    series: SeriesEntry[];
    generatorVersion: string;
    generatedAt: Date;
}): Manifest {
    const catalogs: Record<string, string> = {};
    for (const [kind, key] of Object.entries(input.catalogKeys)) {
        catalogs[kind] = key.split("/").pop() || key;
    }
    return {
        v: 2,
        catalogs,
        counts: input.counts,
        series: input.series,
        generated: input.generatedAt.toISOString(),
        generatorVersion: input.generatorVersion,
        shards: null,
    };
}
