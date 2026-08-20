import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db";
import {
    assetLocations,
    collectionAssets,
    collections,
    mediaAssets,
    mediaRenditions,
    mediaTags,
    tags,
} from "@/db/schema/schema";
import { assetContentHash } from "./content-hash";
import { countryCodeFromName, geographyFromGeocodeResponse } from "./geography";
import type { CatalogAsset, SeriesEntry } from "./catalog";

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
    if (!value) return {};
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
    } catch {
        return {};
    }
}

/**
 * Resolve an asset's geography.
 *
 * Geocode results win when present; the authored country name is the fallback.
 * Region has no fallback on purpose — guessing a subdivision from a city name
 * would produce confident, wrong facets, and an absent region simply drops the
 * asset out of region filters until it is geocoded.
 */
function resolveGeography(
    stored: { countryCode: string | null; regionCode: string | null },
    geocodeJson: string | null,
    authoredCountry: string | null
) {
    if (stored.countryCode || stored.regionCode) return stored;

    const fromGeocode = geographyFromGeocodeResponse(geocodeJson);
    if (fromGeocode.countryCode || fromGeocode.regionCode) return fromGeocode;

    return { countryCode: countryCodeFromName(authoredCountry), regionCode: null };
}

/**
 * Gather everything the catalog needs, and hash each asset.
 *
 * Only published, active images are collected: the catalog is the public
 * contract, and a draft or trashed row appearing in it is a leak, not a bug in
 * presentation.
 */
export function collectPublishableAssets(options?: { includeDrafts?: boolean }): CatalogAsset[] {
    const rows = db
        .select({
            id: mediaAssets.id,
            slug: mediaAssets.slug,
            title: mediaAssets.title,
            objectKey: mediaAssets.objectKey,
            width: mediaAssets.width,
            height: mediaAssets.height,
            countryCode: mediaAssets.countryCode,
            regionCode: mediaAssets.regionCode,
            metadataJson: mediaAssets.metadataJson,
            status: mediaAssets.status,
            kind: mediaAssets.kind,
        })
        .from(mediaAssets)
        .where(
            and(
                eq(mediaAssets.mediaType, "image"),
                eq(mediaAssets.lifecycleStatus, "active")
            )
        )
        .orderBy(asc(mediaAssets.id))
        .all();

    const assets: CatalogAsset[] = [];

    for (const row of rows) {
        if (!options?.includeDrafts && row.status !== "published") continue;
        // Support assets are site chrome. They are catalogued so storage stays
        // reconciled, but they are not works and never reach a reader.
        if (row.kind === "support") continue;

        const metadata = parseJsonObject(row.metadataJson);
        const spreadsheet = parseJsonObject(
            typeof metadata.spreadsheet === "object" && metadata.spreadsheet
                ? JSON.stringify(metadata.spreadsheet)
                : null
        );

        const assetTags = db
            .select({ slug: tags.slug })
            .from(mediaTags)
            .innerJoin(tags, eq(tags.id, mediaTags.tagId))
            .where(eq(mediaTags.assetId, row.id))
            .orderBy(asc(tags.slug))
            .all()
            .map((tag) => tag.slug);

        const renditions = db
            .select({ label: mediaRenditions.label, objectKey: mediaRenditions.objectKey })
            .from(mediaRenditions)
            .where(eq(mediaRenditions.assetId, row.id))
            .orderBy(asc(mediaRenditions.label))
            .all();

        const location = db
            .select({ rawResponseJson: assetLocations.rawResponseJson })
            .from(assetLocations)
            .where(eq(assetLocations.assetId, row.id))
            .get();

        const geography = resolveGeography(
            { countryCode: row.countryCode, regionCode: row.regionCode },
            location?.rawResponseJson ?? null,
            typeof spreadsheet.country === "string" ? spreadsheet.country : null
        );

        // uid is the asset's public identity: rendition keys are built from it
        // and published under a one-year immutable cache, so it has to be
        // stable for the life of the asset. The slug fills that role and is
        // assigned once at creation — importing a title never re-slugs, which
        // is what keeps this safe to embed in permanent URLs.
        const uid = row.slug;

        const artwork = parseJsonObject(
            typeof metadata.artwork === "object" && metadata.artwork
                ? JSON.stringify(metadata.artwork)
                : null
        );

        const series = db
            .select({ slug: collections.slug })
            .from(collectionAssets)
            .innerJoin(collections, eq(collections.id, collectionAssets.collectionId))
            .where(eq(collectionAssets.assetId, row.id))
            .orderBy(asc(collectionAssets.position))
            .all()
            .map((entry) => entry.slug);

        const asset = {
            uid,
            slug: row.slug,
            title: row.title,
            takenAt: typeof spreadsheet.date === "string" ? spreadsheet.date : null,
            countryCode: geography.countryCode,
            regionCode: geography.regionCode,
            city: typeof spreadsheet.city === "string" ? spreadsheet.city : null,
            place: typeof spreadsheet.locationLabel === "string" ? spreadsheet.locationLabel : null,
            camera: typeof spreadsheet.camera === "string" ? spreadsheet.camera : null,
            width: row.width,
            height: row.height,
            lqip: typeof metadata.lqip === "string" ? metadata.lqip : null,
            tags: assetTags,
            renditions,
            // Part of the hash: all three are published, so a change to any of
            // them must invalidate the artifact.
            kind: row.kind as CatalogAsset["kind"],
            year: typeof artwork.year === "string" ? artwork.year : null,
            series,
            rotate: typeof artwork.rotate === "number" ? artwork.rotate : null,
        };

        assets.push({ ...asset, contentHash: assetContentHash(asset) });
    }

    return assets;
}

/** Persist each asset's content hash so the next run can diff against it. */
export function storeContentHashes(assets: Array<{ uid: string; contentHash: string }>) {
    db.transaction((tx) => {
        for (const asset of assets) {
            tx.update(mediaAssets)
                .set({ contentHash: asset.contentHash })
                .where(eq(mediaAssets.slug, asset.uid))
                .run();
        }
    });
    return assets.length;
}

/**
 * Write resolved geography onto the asset's indexed columns.
 *
 * The plan calls for these to be materialised rather than derived per query:
 * the map facets on them on every page, and resolving them means parsing a
 * stored Google response per asset, which is not something to do in a request.
 */
export function materializeGeography(): { updated: number; withRegion: number; withCountry: number } {
    const rows = db
        .select({
            id: mediaAssets.id,
            metadataJson: mediaAssets.metadataJson,
        })
        .from(mediaAssets)
        .where(eq(mediaAssets.lifecycleStatus, "active"))
        .all();

    let updated = 0;
    let withRegion = 0;
    let withCountry = 0;

    db.transaction((tx) => {
        for (const row of rows) {
            const location = tx
                .select({ rawResponseJson: assetLocations.rawResponseJson })
                .from(assetLocations)
                .where(eq(assetLocations.assetId, row.id))
                .get();

            const metadata = parseJsonObject(row.metadataJson);
            const spreadsheet = parseJsonObject(
                typeof metadata.spreadsheet === "object" && metadata.spreadsheet
                    ? JSON.stringify(metadata.spreadsheet)
                    : null
            );

            const geography = resolveGeography(
                { countryCode: null, regionCode: null },
                location?.rawResponseJson ?? null,
                typeof spreadsheet.country === "string" ? spreadsheet.country : null
            );

            if (!geography.countryCode && !geography.regionCode) continue;

            tx.update(mediaAssets)
                .set({ countryCode: geography.countryCode, regionCode: geography.regionCode })
                .where(eq(mediaAssets.id, row.id))
                .run();

            updated += 1;
            if (geography.countryCode) withCountry += 1;
            if (geography.regionCode) withRegion += 1;
        }
    });

    return { updated, withRegion, withCountry };
}

/**
 * Series definitions for the manifest.
 *
 * Carried in the manifest rather than the artwork catalog: the art landing page
 * needs them before it has any artwork rows, and putting them behind the
 * catalog fetch would serialise two round trips for content that is a few
 * hundred bytes.
 */
export function collectSeries(): SeriesEntry[] {
    const rows = db
        .select({
            id: collections.id,
            slug: collections.slug,
            title: collections.title,
            description: collections.description,
        })
        .from(collections)
        .where(eq(collections.kind, "series"))
        .orderBy(asc(collections.slug))
        .all();

    return rows.map((row) => ({
        slug: row.slug,
        title: row.title,
        description: row.description ?? "",
        artworks: db
            .select({ slug: mediaAssets.slug })
            .from(collectionAssets)
            .innerJoin(mediaAssets, eq(mediaAssets.id, collectionAssets.assetId))
            .where(eq(collectionAssets.collectionId, row.id))
            .orderBy(asc(collectionAssets.position))
            .all()
            .map((entry) => entry.slug),
    }));
}
