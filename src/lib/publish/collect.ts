import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db";
import {
    assetLocations,
    mediaAssets,
    mediaRenditions,
    mediaTags,
    tags,
} from "@/db/schema/schema";
import { assetContentHash } from "./content-hash";
import { countryCodeFromName, geographyFromGeocodeResponse } from "./geography";
import type { CatalogAsset } from "./catalog";

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

        // uid is the stable public identity. The slug is derived from the
        // title and can change when a title is corrected; the object key
        // cannot, so it anchors the uid.
        const uid = row.slug;

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
