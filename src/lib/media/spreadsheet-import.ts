import { geocodeAddress, hasGoogleMapsKey } from "../google-maps";
import { parseBatchFilename } from "./filename";
import { slugFromText } from "./normalization";
import { parseMetadataSpreadsheet, type ParsedMetadataRow } from "./spreadsheet";
import { db as defaultDb } from "../../db";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { and, asc, desc, eq, not, sql } from "drizzle-orm";
import type * as BetterSqlite3 from "better-sqlite3";
import {
    assetLocationConflicts,
    assetLocations,
    collectionAssets,
    collections,
    mediaAssets,
    mediaTags,
    photoExif,
    tags,
} from "../../db/schema/schema";

type SpreadsheetDb = typeof defaultDb;
type RawSpreadsheetDb = BetterSqlite3.Database;

function ensureDrizzleDb(database: SpreadsheetDb | RawSpreadsheetDb) {
    if ("select" in database) {
        return database as SpreadsheetDb;
    }
    return drizzle(database as RawSpreadsheetDb);
}

type IndexedAsset = {
    id: number;
    title: string;
    mediaType: string;
    objectKey: string;
    metadataJson: string | null;
};

type AppliedMetadataOptions = {
    titleOverride?: string;
    filenameMetadata?: Record<string, unknown>;
};

type PersistedBatchAsset = {
    assetId: number;
    mediaType: "image" | "video";
};

function now() {
    return new Date();
}

function parseJsonObject(value: string | null | undefined) {
    if (!value) return {};
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
        return {};
    }
}

function uniqueValues(values: string[]) {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
        const normalized = value.trim();
        if (!normalized) continue;
        const key = normalized.toLocaleLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(normalized);
    }
    return out;
}

function normalizeExternalId(value: string | null | undefined) {
    const normalized = String(value || "").trim().toLocaleLowerCase();
    if (!normalized) return "";
    if (/^\d+$/.test(normalized)) {
        return normalized.replace(/^0+(\d+)$/, "$1") || "0";
    }
    return normalized;
}

function basename(value: string) {
    return value.split("/").pop() || value;
}

function stem(value: string) {
    return basename(value).replace(/\.[^.]+$/, "");
}

/**
 * Ids that lead a master filename, e.g. `074+西溪高庄+2023-05-01.JPG` -> ["74"],
 * or the range form `004-009+watercolor shops+…jpg` -> ["4".."9"] where one
 * scan holds several works.
 *
 * Deliberately separate from `parseBatchFilename`: that enforces the batch
 * upload convention `<id>+<name>+YYYYMMDD.<ext>` and throws on anything else.
 * The masters were named by hand with `YYYY-MM-DD` dates, so every one of them
 * throws. Loosening the shared parser would weaken the convention it exists to
 * enforce; this reads ids for indexing only.
 */
function leadingIdsFromFilename(fileName: string): string[] {
    const range = fileName.match(/^(\d{1,4})-(\d{1,4})(?=[+._\-\s])/);
    if (range) {
        const start = Number(range[1]);
        const end = Number(range[2]);
        // A hyphen is also a plain separator (`011-global issue-2021-04-05.jpg`),
        // so only treat it as a range when it reads as one.
        if (end > start && end - start < 100) {
            const ids: string[] = [];
            for (let i = start; i <= end; i += 1) ids.push(String(i));
            return ids;
        }
    }
    const single = fileName.match(/^(\d{1,4})(?=[+._\-\s]|$)/);
    return single ? [String(Number(single[1]))] : [];
}

function buildAssetIndex(db: SpreadsheetDb, options?: { keyPrefix?: string }) {
    const allAssets = db
        .select({
            id: mediaAssets.id,
            title: mediaAssets.title,
            mediaType: mediaAssets.mediaType,
            objectKey: mediaAssets.objectKey,
            metadataJson: mediaAssets.metadataJson,
        })
        .from(mediaAssets)
        .all() as IndexedAsset[];

    // Sheet ids restart at 1 per medium, so photography 001 and artwork 001 are
    // different works that collide on every id-based lookup. Scoping the index
    // to one subtree is what keeps a photography import off an artwork asset.
    const keyPrefix = options?.keyPrefix?.toLocaleLowerCase();
    const assets = keyPrefix
        ? allAssets.filter((asset) => asset.objectKey.toLocaleLowerCase().startsWith(keyPrefix))
        : allAssets;

    const byId = new Map<number, IndexedAsset>();
    const byObjectKey = new Map<string, IndexedAsset>();
    const byFileName = new Map<string, IndexedAsset>();
    const byStem = new Map<string, IndexedAsset>();
    const byExternalId = new Map<string, IndexedAsset>();
    const byFilenameId = new Map<string, IndexedAsset>();
    // Arrays, not single values: two masters claiming one id is a naming fault
    // that must surface, and last-write-wins would hide it.
    const byLeadingId = new Map<string, IndexedAsset[]>();

    for (const asset of assets) {
        for (const id of leadingIdsFromFilename(basename(asset.objectKey))) {
            const bucket = byLeadingId.get(id);
            if (bucket) bucket.push(asset);
            else byLeadingId.set(id, [asset]);
        }
        byId.set(asset.id, asset);
        byObjectKey.set(asset.objectKey.toLocaleLowerCase(), asset);
        byFileName.set(basename(asset.objectKey).toLocaleLowerCase(), asset);
        byStem.set(stem(asset.objectKey).toLocaleLowerCase(), asset);
        try {
            const parsed = parseBatchFilename(basename(asset.objectKey));
            byFilenameId.set(normalizeExternalId(parsed.id), asset);
        } catch {
            // Ignore assets that do not follow the batch filename convention.
        }

        const metadata = parseJsonObject(asset.metadataJson);
        const spreadsheet = metadata.spreadsheet;
        if (spreadsheet && typeof spreadsheet === "object") {
            const externalId = String((spreadsheet as Record<string, unknown>).externalId || "").trim();
            if (externalId) {
                byExternalId.set(normalizeExternalId(externalId), asset);
            }
        }
    }

    return { byId, byObjectKey, byFileName, byStem, byExternalId, byFilenameId, byLeadingId };
}

type MatchResult =
    | { asset: IndexedAsset; ambiguous?: undefined }
    | { asset: null; ambiguous?: IndexedAsset[] };

function matchAssetForRow(row: ParsedMetadataRow, index: ReturnType<typeof buildAssetIndex>): MatchResult {
    if (row.assetId && index.byId.has(row.assetId)) {
        return { asset: index.byId.get(row.assetId) || null };
    }
    if (row.objectKey) {
        const match = index.byObjectKey.get(row.objectKey.toLocaleLowerCase());
        if (match) return { asset: match };
    }
    if (row.fileName) {
        const fileName = row.fileName.toLocaleLowerCase();
        const exact = index.byFileName.get(fileName);
        if (exact) return { asset: exact };
        const byStemMatch = index.byStem.get(stem(fileName).toLocaleLowerCase());
        if (byStemMatch) return { asset: byStemMatch };
    }
    if (row.externalId) {
        const external = normalizeExternalId(row.externalId);
        const fromMetadata = index.byExternalId.get(external);
        if (fromMetadata) return { asset: fromMetadata };
        const fromFilename = index.byFilenameId.get(external);
        if (fromFilename) return { asset: fromFilename };
        const byStemMatch = index.byStem.get(external);
        if (byStemMatch) return { asset: byStemMatch };

        // Last resort: the numeric id leading the master filename. Report a
        // tie instead of picking, so a misnamed master is a visible failure
        // rather than metadata silently written onto the wrong work.
        const candidates = index.byLeadingId.get(external);
        if (candidates?.length === 1) return { asset: candidates[0] };
        if (candidates && candidates.length > 1) {
            // A composite scan (`016-020+…jpg`) and an individual crop
            // (`016.jpg`) both claim the ids in the range, but only the crop is
            // that one work — the composite is the sheet it was cut from. Where
            // exactly one candidate is single-work, it wins; anything else is a
            // real ambiguity and stays unresolved.
            const singleWork = candidates.filter(
                (candidate) => leadingIdsFromFilename(basename(candidate.objectKey)).length === 1
            );
            if (singleWork.length === 1) return { asset: singleWork[0] };
            return { asset: null, ambiguous: candidates };
        }
    }
    return { asset: null };
}


function readAssetTags(db: SpreadsheetDb, assetId: number) {
    return db
        .select({
            slug: tags.slug,
        })
        .from(mediaTags)
        .innerJoin(tags, eq(tags.id, mediaTags.tagId))
        .where(eq(mediaTags.assetId, assetId))
        .orderBy(asc(tags.slug))
        .all()
        .map((row) => row.slug);
}

function readAssetCollections(db: SpreadsheetDb, assetId: number) {
    return db
        .select({
            title: collections.title,
        })
        .from(collectionAssets)
        .innerJoin(collections, eq(collections.id, collectionAssets.collectionId))
        .where(eq(collectionAssets.assetId, assetId))
        .orderBy(asc(collectionAssets.position), asc(collections.title))
        .all()
        .map((row) => row.title);
}

function buildUniqueSlug(db: SpreadsheetDb, base: string, currentAssetId?: number) {
    const cleanBase = slugFromText(base);
    let slug = cleanBase;
    let suffix = 2;

    while (true) {
        const existing = db
            .select({ id: mediaAssets.id })
            .from(mediaAssets)
            .where(eq(mediaAssets.slug, slug))
            .limit(1)
            .get() as { id: number } | undefined;
        if (!existing || existing.id === currentAssetId) {
            return slug;
        }
        slug = `${cleanBase}-${suffix++}`;
    }
}

function ensureTag(db: SpreadsheetDb, value: string) {
    const slug = slugFromText(value);
    const existing = db.select({ id: tags.id }).from(tags).where(eq(tags.slug, slug)).get();
    if (existing) return existing.id;

    const result = db
        .insert(tags)
        .values({
            label: value.trim(),
            slug,
            createdAt: now(),
        })
        .run();
    return Number(result.lastInsertRowid);
}

function ensureCollection(db: SpreadsheetDb, name: string) {
    const title = name.trim();
    const normalizedTitle = title.toLocaleLowerCase();
    const existing = db
        .select({ id: collections.id })
        .from(collections)
        .where(sql`lower(${collections.title}) = ${normalizedTitle}`)
        .get();
    if (existing) return existing.id;

    const result = db
        .insert(collections)
        .values({
            title,
            slug: buildUniqueSlug(db, title),
            kind: "collection",
            createdAt: now(),
            updatedAt: now(),
        })
        .run();
    return Number(result.lastInsertRowid);
}

function replaceAssetTags(db: SpreadsheetDb, assetId: number, tags: string[]) {
    db.delete(mediaTags).where(eq(mediaTags.assetId, assetId)).run();
    for (const tag of tags) {
        const tagId = ensureTag(db, tag);
        db.insert(mediaTags).values({ assetId, tagId, appliedAt: now() }).run();
    }
}

function replaceAssetCollections(db: SpreadsheetDb, assetId: number, collections: string[]) {
    db.delete(collectionAssets).where(eq(collectionAssets.assetId, assetId)).run();
    collections.forEach((collection, index) => {
        const collectionId = ensureCollection(db, collection);
        db.insert(collectionAssets)
            .values({
                collectionId,
                assetId,
                position: index,
                addedAt: now(),
            })
            .run();
    });
}

async function buildLocation(row: ParsedMetadataRow) {
    if (row.lat !== null && row.lat !== undefined && row.lng !== null && row.lng !== undefined) {
        return {
            label: row.locationLabel,
            rawAddress: row.rawAddress,
            formattedAddress: row.formattedAddress || row.rawAddress,
            lat: row.lat,
            lng: row.lng,
            source: "spreadsheet",
            sourceRef: row.sourceRef,
            status: "geocoded" as const,
        };
    }

    if (!row.rawAddress) return null;

    if (!hasGoogleMapsKey()) {
        return {
            label: row.locationLabel,
            rawAddress: row.rawAddress,
            formattedAddress: row.formattedAddress,
            source: "spreadsheet",
            sourceRef: row.sourceRef,
            status: "pending" as const,
        };
    }

    try {
        const geocoded = await geocodeAddress(row.rawAddress);
        if (!geocoded) {
            return {
                label: row.locationLabel,
                rawAddress: row.rawAddress,
                formattedAddress: row.formattedAddress,
                source: "spreadsheet",
                sourceRef: row.sourceRef,
                status: "failed" as const,
            };
        }

        return {
            label: row.locationLabel,
            rawAddress: row.rawAddress,
            formattedAddress: geocoded.formattedAddress,
            googlePlaceId: geocoded.placeId,
            lat: geocoded.lat,
            lng: geocoded.lng,
            source: "spreadsheet",
            sourceRef: row.sourceRef,
            status: "geocoded" as const,
            rawResponseJson: geocoded.rawResponseJson,
        };
    } catch {
        return {
            label: row.locationLabel,
            rawAddress: row.rawAddress,
            formattedAddress: row.formattedAddress,
            source: "spreadsheet",
            sourceRef: row.sourceRef,
            status: "failed" as const,
        };
    }
}

function saveImportedLocation(
    db: SpreadsheetDb,
    assetId: number,
    mediaType: string,
    location: Awaited<ReturnType<typeof buildLocation>>
) {
    if (!location) return;
    const timestamp = now();

    if (mediaType === "image") {
        db.delete(assetLocations)
            .where(and(eq(assetLocations.assetId, assetId), not(eq(assetLocations.source, "exif"))))
            .run();
    } else {
        db.update(assetLocations)
            .set({ isPrimary: false, updatedAt: timestamp })
            .where(eq(assetLocations.assetId, assetId))
            .run();
    }

    const result = db.insert(assetLocations).values({
        assetId,
        contentType: "media",
        label: location.label || null,
        rawAddress: location.rawAddress || null,
        formattedAddress: location.formattedAddress || null,
        googlePlaceId: location.googlePlaceId || null,
        lat: location.lat ?? null,
        lng: location.lng ?? null,
        isPrimary: true,
        source: location.source,
        sourceRef: location.sourceRef || null,
        status: location.status,
        rawResponseJson: location.rawResponseJson || null,
        createdAt: timestamp,
        updatedAt: timestamp,
    }).run();

    if (mediaType === "image") {
        reconcileStoredExifLocation(db, assetId, Number(result.lastInsertRowid));
    }
}

const EXIF_LOCATION_MATCH_DISTANCE_METERS = 100;

function resolvePendingExifConflicts(
    db: SpreadsheetDb,
    assetId: number,
    resolution: "keep_exif" | "keep_existing",
    timestamp: Date
) {
    db.update(assetLocationConflicts)
        .set({
            resolution,
            resolvedBy: null,
            resolvedAt: timestamp,
            status: "resolved",
            updatedAt: timestamp,
        })
        .where(
            and(eq(assetLocationConflicts.assetId, assetId), eq(assetLocationConflicts.status, "pending"))
        )
        .run();
}

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
    const earthRadius = 6371000;
    const latDelta = ((b.lat - a.lat) * Math.PI) / 180;
    const lngDelta = ((b.lng - a.lng) * Math.PI) / 180;
    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;
    const hav =
        Math.sin(latDelta / 2) ** 2 +
        Math.sin(lngDelta / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
    return 2 * earthRadius * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));
}

function reconcileStoredExifLocation(db: SpreadsheetDb, assetId: number, existingLocationId: number) {
    const exifRow = db
        .select({
            gpsLat: photoExif.gpsLat,
            gpsLng: photoExif.gpsLng,
            gpsAltitudeM: photoExif.gpsAltitudeM,
        })
        .from(photoExif)
        .where(eq(photoExif.assetId, assetId))
        .get();
    if (!exifRow || exifRow.gpsLat == null || exifRow.gpsLng == null) {
        return;
    }

    const existingExif = db
        .select({ id: assetLocations.id })
        .from(assetLocations)
        .where(and(eq(assetLocations.assetId, assetId), eq(assetLocations.source, "exif")))
        .orderBy(asc(assetLocations.id))
        .limit(1)
        .get();
    const timestamp = now();
    let exifLocationId = existingExif?.id;

    if (!exifLocationId) {
        const insertResult = db.insert(assetLocations).values({
            assetId,
            contentType: "media",
            label: "EXIF GPS",
            lat: exifRow.gpsLat,
            lng: exifRow.gpsLng,
            isPrimary: false,
            source: "exif",
            sourceRef: "exif",
            status: "pending",
            createdAt: timestamp,
            updatedAt: timestamp,
        }).run();
        exifLocationId = Number(insertResult.lastInsertRowid);
    }

    db.update(assetLocations)
        .set({
            label: "EXIF GPS",
            lat: exifRow.gpsLat,
            lng: exifRow.gpsLng,
            status: "pending",
            updatedAt: timestamp,
        })
        .where(eq(assetLocations.id, exifLocationId))
        .run();

    const existingRow = db
        .select({
            id: assetLocations.id,
            lat: assetLocations.lat,
            lng: assetLocations.lng,
        })
        .from(assetLocations)
        .where(eq(assetLocations.id, existingLocationId))
        .get();
    if (!existingRow) return;

    const hasExistingCoords = existingRow.lat != null && existingRow.lng != null;
    const distance =
        hasExistingCoords
            ? distanceMeters(
                  { lat: Number(existingRow.lat), lng: Number(existingRow.lng) },
                  { lat: Number(exifRow.gpsLat), lng: Number(exifRow.gpsLng) }
              )
            : null;

    if (!hasExistingCoords || (distance !== null && distance > EXIF_LOCATION_MATCH_DISTANCE_METERS)) {
        db.update(assetLocations)
            .set({ isPrimary: false, updatedAt: timestamp })
            .where(eq(assetLocations.assetId, assetId))
            .run();
        db.update(assetLocations)
            .set({ isPrimary: false, status: "matched", updatedAt: timestamp })
            .where(eq(assetLocations.id, existingLocationId))
            .run();
        db.update(assetLocations)
            .set({ isPrimary: true, status: "pending", updatedAt: timestamp })
            .where(eq(assetLocations.id, exifLocationId))
            .run();

        const existingConflict = db
            .select({ id: assetLocationConflicts.id })
            .from(assetLocationConflicts)
            .where(
                and(eq(assetLocationConflicts.assetId, assetId), eq(assetLocationConflicts.status, "pending"))
            )
            .orderBy(desc(assetLocationConflicts.id))
            .limit(1)
            .get();

        if (existingConflict?.id) {
            db.update(assetLocationConflicts)
                .set({
                    existingLocationId,
                    candidateLocationId: exifLocationId,
                    distanceMeters: distance,
                    updatedAt: timestamp,
                })
                .where(eq(assetLocationConflicts.id, existingConflict.id))
                .run();
        } else {
            db.insert(assetLocationConflicts)
                .values({
                    assetId,
                    existingLocationId,
                    candidateLocationId: exifLocationId,
                    distanceMeters: distance,
                    status: "pending",
                    createdAt: timestamp,
                    updatedAt: timestamp,
                })
                .run();
        }
        return;
    }

    db.update(assetLocations)
        .set({ isPrimary: true, status: "matched", updatedAt: timestamp })
        .where(eq(assetLocations.id, existingLocationId))
        .run();
    db.update(assetLocations)
        .set({ isPrimary: false, status: "matched", updatedAt: timestamp })
        .where(eq(assetLocations.id, exifLocationId))
        .run();
    resolvePendingExifConflicts(db, assetId, "keep_existing", timestamp);
}

function updateAssetMetadataJson(db: SpreadsheetDb, assetId: number, row: ParsedMetadataRow, options?: AppliedMetadataOptions) {
    const existing = db
        .select({ metadataJson: mediaAssets.metadataJson })
        .from(mediaAssets)
        .where(eq(mediaAssets.id, assetId))
        .get();
    const metadata = parseJsonObject(existing?.metadataJson);

    metadata.spreadsheet = {
        ...(metadata.spreadsheet && typeof metadata.spreadsheet === "object" ? metadata.spreadsheet : {}),
        sourceFile: row.sourceFile,
        sheetName: row.sheetName,
        rowNumber: row.rowNumber,
        sourceRef: row.sourceRef,
        externalId: row.externalId,
        date: row.date,
        country: row.country,
        city: row.city,
        locationLabel: row.locationLabel,
        rawAddress: row.rawAddress,
        formattedAddress: row.formattedAddress,
        camera: row.camera,
        tool: row.tool,
        sourceWork: row.sourceWork,
        raw: row.raw,
    };
    if (options?.filenameMetadata) {
        metadata.filename = {
            ...(metadata.filename && typeof metadata.filename === "object" ? metadata.filename : {}),
            ...options.filenameMetadata,
        };
    }

    db.update(mediaAssets)
        .set({
            metadataJson: JSON.stringify(metadata),
            updatedAt: now(),
        })
        .where(eq(mediaAssets.id, assetId))
        .run();
}

function updateAssetBasics(db: SpreadsheetDb, asset: IndexedAsset, row: ParsedMetadataRow, options?: AppliedMetadataOptions) {
    if (!row.title && !row.description && !options?.titleOverride) return;

    const current = db
        .select({ title: mediaAssets.title, description: mediaAssets.description })
        .from(mediaAssets)
        .where(eq(mediaAssets.id, asset.id))
        .get();
    if (!current) return;

    const nextTitle = options?.titleOverride?.trim() || row.title?.trim() || current.title;
    const nextDescription = row.description?.trim() || current.description;

    db.update(mediaAssets)
        .set({
            title: nextTitle,
            slug: buildUniqueSlug(db, nextTitle, asset.id),
            description: nextDescription || null,
            updatedAt: now(),
        })
        .where(eq(mediaAssets.id, asset.id))
        .run();
}

export async function importMediaSpreadsheetIntoDb(
    dbInput: SpreadsheetDb | RawSpreadsheetDb,
    input: {
        fileName: string;
        bytes: Buffer | Uint8Array;
        /**
         * Restrict matching to assets whose object key starts with this prefix.
         * Sheet ids restart at 1 per medium, so an unscoped import of the
         * photography sheet can land on an artwork asset holding the same id.
         */
        keyPrefix?: string;
        /** Report what would change without writing. */
        dryRun?: boolean;
    }
) {
    const db = ensureDrizzleDb(dbInput);
    const parsed = parseMetadataSpreadsheet(input);
    const summary = {
        fileName: input.fileName,
        keyPrefix: input.keyPrefix || null,
        rows: parsed.rows.length,
        imported: 0,
        unmatched: 0,
        ambiguous: 0,
        geocoded: 0,
        pending: 0,
        failed: 0,
        updatedTags: 0,
        updatedCollections: 0,
        // Rows that did not resolve to exactly one asset, with enough context to
        // act on. A bare count is not actionable at cutover.
        unresolved: [] as Array<{
            externalId: string | null;
            reason: "unmatched" | "ambiguous";
            candidates?: string[];
        }>,
    };

    const index = buildAssetIndex(db, { keyPrefix: input.keyPrefix });

    for (const row of parsed.rows) {
        const match = matchAssetForRow(row, index);
        const asset = match.asset;
        if (!asset) {
            const ambiguous = (match.ambiguous?.length ?? 0) > 0;
            if (ambiguous) summary.ambiguous += 1;
            else summary.unmatched += 1;
            summary.unresolved.push({
                externalId: row.externalId,
                reason: ambiguous ? "ambiguous" : "unmatched",
                ...(ambiguous ? { candidates: match.ambiguous!.map((a) => a.objectKey) } : {}),
            });
            continue;
        }
        if (input.dryRun) {
            summary.imported += 1;
            continue;
        }

        updateAssetBasics(db, asset, row);
        updateAssetMetadataJson(db, asset.id, row);

        if (row.tagSlugs.length > 0) {
            const mergedTags = uniqueValues([...readAssetTags(db, asset.id), ...row.tagSlugs]);
            replaceAssetTags(db, asset.id, mergedTags);
            summary.updatedTags += 1;
        }

        if (row.collectionNames.length > 0) {
            const mergedCollections = uniqueValues([...readAssetCollections(db, asset.id), ...row.collectionNames]);
            replaceAssetCollections(db, asset.id, mergedCollections);
            summary.updatedCollections += 1;
        }

        const location = await buildLocation(row);
        if (location) {
            saveImportedLocation(db, asset.id, asset.mediaType, location);
            if (location.status === "geocoded") summary.geocoded += 1;
            if (location.status === "pending") summary.pending += 1;
            if (location.status === "failed") summary.failed += 1;
        }

        summary.imported += 1;

        if (row.externalId) {
            index.byExternalId.set(normalizeExternalId(row.externalId), asset);
        }
    }

    return summary;
}

function findRowByExternalId(rows: ParsedMetadataRow[]) {
    const byExternalId = new Map<string, ParsedMetadataRow>();
    for (const row of rows) {
        if (!row.externalId) continue;
        byExternalId.set(normalizeExternalId(row.externalId), row);
    }
    return byExternalId;
}

function mediaTypeForUpload(fileName: string, mimeType?: string | null) {
    if (mimeType?.startsWith("image/")) return "image" as const;
    if (mimeType?.startsWith("video/")) return "video" as const;
    const extension = fileName.split(".").pop()?.toLowerCase();
    if (["jpg", "jpeg", "png", "gif", "webp", "avif"].includes(extension || "")) return "image" as const;
    if (["mp4", "mov", "webm", "m4v"].includes(extension || "")) return "video" as const;
    return null;
}

function getIndexedAssetById(db: SpreadsheetDb, assetId: number) {
    return db
        .select({
            id: mediaAssets.id,
            title: mediaAssets.title,
            mediaType: mediaAssets.mediaType,
            objectKey: mediaAssets.objectKey,
            metadataJson: mediaAssets.metadataJson,
        })
        .from(mediaAssets)
        .where(eq(mediaAssets.id, assetId))
        .get() as IndexedAsset | undefined;
}

export async function batchIngestMediaIntoDb(
    dbInput: SpreadsheetDb | RawSpreadsheetDb,
    input: {
        spreadsheet: { fileName: string; bytes: Buffer | Uint8Array };
        mediaFiles: Array<{ fileName: string; bytes: Uint8Array; mimeType?: string | null }>;
        persistFile: (file: {
            fileName: string;
            bytes: Uint8Array;
            mimeType?: string | null;
            mediaType: "image" | "video";
            parsedFileName: ReturnType<typeof parseBatchFilename>;
            matchedRow: ParsedMetadataRow;
        }) => Promise<PersistedBatchAsset>;
    }
) {
    const db = ensureDrizzleDb(dbInput);
    const parsedSpreadsheet = parseMetadataSpreadsheet(input.spreadsheet);
    const rowsByExternalId = findRowByExternalId(parsedSpreadsheet.rows);
    const summary = {
        spreadsheetFileName: input.spreadsheet.fileName,
        rows: parsedSpreadsheet.rows.length,
        files: input.mediaFiles.length,
        imported: 0,
        unmatchedRows: parsedSpreadsheet.rows.length,
        unmatchedFiles: 0,
        invalidFiles: 0,
        geocoded: 0,
        pending: 0,
        failed: 0,
        updatedTags: 0,
        updatedCollections: 0,
    };

    for (const mediaFile of input.mediaFiles) {
        let parsedFileName: ReturnType<typeof parseBatchFilename>;
        try {
            parsedFileName = parseBatchFilename(mediaFile.fileName);
        } catch {
            summary.invalidFiles += 1;
            continue;
        }

        const matchedRow = rowsByExternalId.get(normalizeExternalId(parsedFileName.id));
        if (!matchedRow) {
            summary.unmatchedFiles += 1;
            continue;
        }

        const mediaType = mediaTypeForUpload(mediaFile.fileName, mediaFile.mimeType);
        if (!mediaType) {
            summary.invalidFiles += 1;
            continue;
        }

        const persisted = await input.persistFile({
            fileName: mediaFile.fileName,
            bytes: mediaFile.bytes,
            mimeType: mediaFile.mimeType,
            mediaType,
            parsedFileName,
            matchedRow,
        });
        const asset = getIndexedAssetById(db, persisted.assetId);
        if (!asset) {
            summary.unmatchedFiles += 1;
            continue;
        }

        updateAssetBasics(db, asset, matchedRow, {
            titleOverride: parsedFileName.name,
        });
        updateAssetMetadataJson(db, asset.id, matchedRow, {
            filenameMetadata: {
                id: parsedFileName.id,
                name: parsedFileName.name,
                date: parsedFileName.date,
                ext: parsedFileName.ext,
            },
        });

        if (matchedRow.tagSlugs.length > 0) {
            const mergedTags = uniqueValues([...readAssetTags(db, asset.id), ...matchedRow.tagSlugs]);
            replaceAssetTags(db, asset.id, mergedTags);
            summary.updatedTags += 1;
        }

        if (matchedRow.collectionNames.length > 0) {
            const mergedCollections = uniqueValues([...readAssetCollections(db, asset.id), ...matchedRow.collectionNames]);
            replaceAssetCollections(db, asset.id, mergedCollections);
            summary.updatedCollections += 1;
        }

        const location = await buildLocation(matchedRow);
        if (location) {
            saveImportedLocation(db, asset.id, asset.mediaType, location);
            if (location.status === "geocoded") summary.geocoded += 1;
            if (location.status === "pending") summary.pending += 1;
            if (location.status === "failed") summary.failed += 1;
        }

        summary.imported += 1;
        if (matchedRow.externalId) {
            rowsByExternalId.delete(normalizeExternalId(matchedRow.externalId));
        }
    }

    summary.unmatchedRows = rowsByExternalId.size;
    return summary;
}

export async function importMediaSpreadsheet(input: { fileName: string; bytes: Buffer | Uint8Array }) {
    const { db } = await import("../../db");
    return importMediaSpreadsheetIntoDb(db, input);
}
