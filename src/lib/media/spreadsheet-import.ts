import { geocodeAddress, hasGoogleMapsKey } from "../google-maps";
import { parseBatchFilename } from "./filename";
import { slugFromText } from "./normalization";
import { parseMetadataSpreadsheet, type ParsedMetadataRow } from "./spreadsheet";

type DbLike = {
    prepare: (sql: string) => unknown;
};

type StatementLike = {
    all: (...params: unknown[]) => unknown[];
    get: (...params: unknown[]) => unknown;
    run: (...params: unknown[]) => { lastInsertRowid?: number | bigint };
};

function stmt(db: DbLike, sql: string) {
    return db.prepare(sql) as StatementLike;
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
    return Date.now();
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

function basename(value: string) {
    return value.split("/").pop() || value;
}

function stem(value: string) {
    return basename(value).replace(/\.[^.]+$/, "");
}

function buildAssetIndex(db: DbLike) {
    const assets = stmt(db, `
            select id, title, media_type as mediaType, object_key as objectKey, metadata_json as metadataJson
            from media_assets
        `)
        .all() as IndexedAsset[];

    const byId = new Map<number, IndexedAsset>();
    const byObjectKey = new Map<string, IndexedAsset>();
    const byFileName = new Map<string, IndexedAsset>();
    const byStem = new Map<string, IndexedAsset>();
    const byExternalId = new Map<string, IndexedAsset>();
    const byFilenameId = new Map<string, IndexedAsset>();

    for (const asset of assets) {
        byId.set(asset.id, asset);
        byObjectKey.set(asset.objectKey.toLocaleLowerCase(), asset);
        byFileName.set(basename(asset.objectKey).toLocaleLowerCase(), asset);
        byStem.set(stem(asset.objectKey).toLocaleLowerCase(), asset);
        try {
            const parsed = parseBatchFilename(basename(asset.objectKey));
            byFilenameId.set(parsed.id.toLocaleLowerCase(), asset);
        } catch {
            // Ignore assets that do not follow the batch filename convention.
        }

        const metadata = parseJsonObject(asset.metadataJson);
        const spreadsheet = metadata.spreadsheet;
        if (spreadsheet && typeof spreadsheet === "object") {
            const externalId = String((spreadsheet as Record<string, unknown>).externalId || "").trim();
            if (externalId) {
                byExternalId.set(externalId.toLocaleLowerCase(), asset);
            }
        }
    }

    return { byId, byObjectKey, byFileName, byStem, byExternalId, byFilenameId };
}

function findAssetForRow(row: ParsedMetadataRow, index: ReturnType<typeof buildAssetIndex>) {
    if (row.assetId && index.byId.has(row.assetId)) {
        return index.byId.get(row.assetId) || null;
    }
    if (row.objectKey) {
        const match = index.byObjectKey.get(row.objectKey.toLocaleLowerCase());
        if (match) return match;
    }
    if (row.fileName) {
        const fileName = row.fileName.toLocaleLowerCase();
        const exact = index.byFileName.get(fileName);
        if (exact) return exact;
        const byStem = index.byStem.get(stem(fileName).toLocaleLowerCase());
        if (byStem) return byStem;
    }
    if (row.externalId) {
        const external = row.externalId.toLocaleLowerCase();
        const fromMetadata = index.byExternalId.get(external);
        if (fromMetadata) return fromMetadata;
        const fromFilename = index.byFilenameId.get(external);
        if (fromFilename) return fromFilename;
        const byStem = index.byStem.get(external);
        if (byStem) return byStem;
    }
    return null;
}

function readAssetTags(db: DbLike, assetId: number) {
    return stmt(db, `
            select t.slug
            from media_tags mt
            join tags t on t.id = mt.tag_id
            where mt.asset_id = ?
            order by t.slug asc
        `)
        .all(assetId)
        .map((item) => (item as { slug: string }).slug);
}

function readAssetCollections(db: DbLike, assetId: number) {
    return stmt(db, `
            select c.title
            from collection_assets ca
            join collections c on c.id = ca.collection_id
            where ca.asset_id = ?
            order by ca.position asc, c.title asc
        `)
        .all(assetId)
        .map((item) => (item as { title: string }).title);
}

function buildUniqueSlug(db: DbLike, base: string, currentAssetId?: number) {
    const cleanBase = slugFromText(base);
    let slug = cleanBase;
    let suffix = 2;

    while (true) {
        const existing = stmt(db, "select id from media_assets where slug = ?").get(slug) as { id: number } | undefined;
        if (!existing || existing.id === currentAssetId) {
            return slug;
        }
        slug = `${cleanBase}-${suffix++}`;
    }
}

function ensureTag(db: DbLike, value: string) {
    const slug = slugFromText(value);
    const existing = stmt(db, "select id from tags where slug = ?").get(slug) as { id: number } | undefined;
    if (existing) return existing.id;

    const result = stmt(db, `
            insert into tags (label, slug, created_at)
            values (?, ?, ?)
        `)
        .run(value.trim(), slug, now());
    return Number(result.lastInsertRowid);
}

function ensureCollection(db: DbLike, name: string) {
    const title = name.trim();
    const normalizedTitle = title.toLocaleLowerCase();
    const existing = stmt(db, "select id from collections where lower(title) = ?").get(normalizedTitle) as {
        id: number;
    } | undefined;
    if (existing) return existing.id;

    const result = stmt(db, `
            insert into collections (title, slug, kind, created_at, updated_at)
            values (?, ?, 'collection', ?, ?)
        `)
        .run(title, buildUniqueSlug(db, title), now(), now());
    return Number(result.lastInsertRowid);
}

function replaceAssetTags(db: DbLike, assetId: number, tags: string[]) {
    stmt(db, "delete from media_tags where asset_id = ?").run(assetId);
    for (const tag of tags) {
        const tagId = ensureTag(db, tag);
        stmt(db, "insert into media_tags (asset_id, tag_id, applied_at) values (?, ?, ?)").run(assetId, tagId, now());
    }
}

function replaceAssetCollections(db: DbLike, assetId: number, collections: string[]) {
    stmt(db, "delete from collection_assets where asset_id = ?").run(assetId);
    collections.forEach((collection, index) => {
        const collectionId = ensureCollection(db, collection);
        stmt(db, `
            insert into collection_assets (collection_id, asset_id, position, added_at)
            values (?, ?, ?, ?)
        `).run(collectionId, assetId, index, now());
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

function saveImportedLocation(db: DbLike, assetId: number, mediaType: string, location: Awaited<ReturnType<typeof buildLocation>>) {
    if (!location) return;

    if (mediaType === "image") {
        stmt(db, "delete from asset_locations where asset_id = ?").run(assetId);
    } else {
        stmt(db, "update asset_locations set is_primary = 0 where asset_id = ?").run(assetId);
    }

    stmt(db, `
        insert into asset_locations (
            asset_id,
            content_type,
            label,
            raw_address,
            formatted_address,
            google_place_id,
            lat,
            lng,
            is_primary,
            source,
            source_ref,
            status,
            raw_response_json,
            created_at,
            updated_at
        )
        values (?, 'media', ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
    `).run(
        assetId,
        location.label || null,
        location.rawAddress || null,
        location.formattedAddress || null,
        location.googlePlaceId || null,
        location.lat ?? null,
        location.lng ?? null,
        location.source,
        location.sourceRef || null,
        location.status,
        location.rawResponseJson || null,
        now(),
        now()
    );
}

function updateAssetMetadataJson(db: DbLike, assetId: number, row: ParsedMetadataRow, options?: AppliedMetadataOptions) {
    const existing = stmt(db, "select metadata_json from media_assets where id = ?").get(assetId) as
        | { metadata_json?: string | null }
        | undefined;
    const metadata = parseJsonObject(existing?.metadata_json);

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

    stmt(db, `
        update media_assets
        set metadata_json = ?,
            updated_at = ?
        where id = ?
    `).run(JSON.stringify(metadata), now(), assetId);
}

function updateAssetBasics(db: DbLike, asset: IndexedAsset, row: ParsedMetadataRow, options?: AppliedMetadataOptions) {
    if (!row.title && !row.description && !options?.titleOverride) return;

    const current = stmt(db, "select title, description from media_assets where id = ?").get(asset.id) as
        | { title: string; description: string | null }
        | undefined;
    if (!current) return;

    const nextTitle = options?.titleOverride?.trim() || row.title?.trim() || current.title;
    const nextDescription = row.description?.trim() || current.description;

    stmt(db, `
        update media_assets
        set title = ?,
            slug = ?,
            description = ?,
            updated_at = ?
        where id = ?
    `).run(nextTitle, buildUniqueSlug(db, nextTitle, asset.id), nextDescription || null, now(), asset.id);
}

export async function importMediaSpreadsheetIntoDb(db: DbLike, input: { fileName: string; bytes: Buffer | Uint8Array }) {
    const parsed = parseMetadataSpreadsheet(input);
    const summary = {
        fileName: input.fileName,
        rows: parsed.rows.length,
        imported: 0,
        unmatched: 0,
        geocoded: 0,
        pending: 0,
        failed: 0,
        updatedTags: 0,
        updatedCollections: 0,
    };

    const index = buildAssetIndex(db);

    for (const row of parsed.rows) {
        const asset = findAssetForRow(row, index);
        if (!asset) {
            summary.unmatched += 1;
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
            index.byExternalId.set(row.externalId.toLocaleLowerCase(), asset);
        }
    }

    return summary;
}

function findRowByExternalId(rows: ParsedMetadataRow[]) {
    const byExternalId = new Map<string, ParsedMetadataRow>();
    for (const row of rows) {
        if (!row.externalId) continue;
        byExternalId.set(row.externalId.toLocaleLowerCase(), row);
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

function getIndexedAssetById(db: DbLike, assetId: number) {
    return stmt(
        db,
        `
            select id, title, media_type as mediaType, object_key as objectKey, metadata_json as metadataJson
            from media_assets
            where id = ?
        `
    ).get(assetId) as IndexedAsset | undefined;
}

export async function batchIngestMediaIntoDb(
    db: DbLike,
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

        const matchedRow = rowsByExternalId.get(parsedFileName.id.toLocaleLowerCase());
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
            rowsByExternalId.delete(matchedRow.externalId.toLocaleLowerCase());
        }
    }

    summary.unmatchedRows = rowsByExternalId.size;
    return summary;
}

export async function importMediaSpreadsheet(input: { fileName: string; bytes: Buffer | Uint8Array }) {
    const { sqlite } = await import("../../db");
    return importMediaSpreadsheetIntoDb(sqlite, input);
}
