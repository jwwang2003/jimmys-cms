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
 */

/** Column order is part of the wire contract; readers index by position. */
export const CATALOG_FIELDS = [
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

/** Columns interned into a dictionary and stored as integer indices. */
type DictColumn = "country" | "region" | "city" | "place" | "camera" | "tags";

export type CatalogAsset = HashableAsset & { contentHash: string };

export type Catalog = {
    v: number;
    fields: readonly string[];
    dict: Record<string, string[]>;
    rows: unknown[][];
    order: { chrono: number[] };
    postings: {
        country: Record<string, number[]>;
        region: Record<string, number[]>;
        year: Record<string, number[]>;
        tag: Record<string, number[]>;
        camera: Record<string, number[]>;
    };
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

function pushPosting(target: Record<string, number[]>, key: string, rowIndex: number) {
    const bucket = target[key];
    if (bucket) bucket.push(rowIndex);
    else target[key] = [rowIndex];
}

/**
 * Build the catalog payload.
 *
 * Rows are emitted in a stable order — by uid — so that the serialized bytes
 * depend only on content. If row order tracked a database query's whim, two
 * runs over identical data would produce different bytes and the publish diff
 * would rewrite the catalog every time.
 */
export function buildCatalog(assets: CatalogAsset[]): Catalog {
    const ordered = [...assets].sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));

    const interners: Record<DictColumn, Interner> = {
        country: new Interner(),
        region: new Interner(),
        city: new Interner(),
        place: new Interner(),
        camera: new Interner(),
        tags: new Interner(),
    };

    const rows: unknown[][] = [];
    const postings: Catalog["postings"] = {
        country: {},
        region: {},
        year: {},
        tag: {},
        camera: {},
    };

    ordered.forEach((asset, rowIndex) => {
        const country = asset.countryCode ? interners.country.intern(asset.countryCode) : null;
        const region = asset.regionCode ? interners.region.intern(asset.regionCode) : null;
        const city = asset.city ? interners.city.intern(asset.city) : null;
        const place = asset.place ? interners.place.intern(asset.place) : null;
        const camera = asset.camera ? interners.camera.intern(asset.camera) : null;
        const tagIds = [...asset.tags].sort().map((tag) => interners.tags.intern(tag));

        rows.push([
            asset.uid,
            asset.slug,
            asset.takenAt,
            country,
            region,
            city,
            place,
            asset.title,
            camera,
            asset.width,
            asset.height,
            asset.lqip,
            tagIds,
        ]);

        if (asset.countryCode) pushPosting(postings.country, asset.countryCode, rowIndex);
        if (asset.regionCode) pushPosting(postings.region, asset.regionCode, rowIndex);
        if (asset.camera) pushPosting(postings.camera, asset.camera, rowIndex);
        if (asset.takenAt) pushPosting(postings.year, asset.takenAt.slice(0, 4), rowIndex);
        // Tag postings key on the interned id, matching §8.1's `"tag": { "3": … }`.
        for (const tagId of tagIds) pushPosting(postings.tag, String(tagId), rowIndex);
    });

    // Precomputed chronological order: the client never sorts, and every result
    // set is a filtered projection of this, which also keeps result order stable
    // as filters change. Undated rows sort last, then by uid so ties are stable.
    const chrono = ordered
        .map((asset, index) => ({ index, takenAt: asset.takenAt, uid: asset.uid }))
        .sort((a, b) => {
            if (a.takenAt && b.takenAt) {
                if (a.takenAt !== b.takenAt) return a.takenAt < b.takenAt ? -1 : 1;
            } else if (a.takenAt) return -1;
            else if (b.takenAt) return 1;
            return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
        })
        .map((entry) => entry.index);

    // Sort each posting list so the serialization is order-independent.
    for (const group of Object.values(postings)) {
        for (const key of Object.keys(group)) group[key].sort((a, b) => a - b);
    }

    return {
        v: 1,
        fields: CATALOG_FIELDS,
        dict: {
            country: interners.country.toArray(),
            region: interners.region.toArray(),
            city: interners.city.toArray(),
            place: interners.place.toArray(),
            camera: interners.camera.toArray(),
            tags: interners.tags.toArray(),
        },
        rows,
        order: { chrono },
        postings,
        count: ordered.length,
    };
}

export type Manifest = {
    v: number;
    catalog: string;
    count: number;
    generated: string;
    generatorVersion: string;
    shards: null;
};

/**
 * The manifest is the one mutable object, so it is deliberately tiny and served
 * no-cache. It carries a timestamp because it is not content-addressed; the
 * catalog it points at is.
 */
export function buildManifest(input: {
    catalogKey: string;
    count: number;
    generatorVersion: string;
    generatedAt: Date;
}): Manifest {
    return {
        v: 1,
        catalog: input.catalogKey.split("/").pop() || input.catalogKey,
        count: input.count,
        generated: input.generatedAt.toISOString(),
        generatorVersion: input.generatorVersion,
        shards: null,
    };
}
