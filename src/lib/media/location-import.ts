import { hasGoogleMapsKey, geocodeAddress } from "@/lib/google-maps";
import { findMediaAssetByReference, saveImportedLocation } from "./repository";
import { parseLocationCsv, type ImportedLocationRow } from "./location-csv";
import type { AssetLocationInput } from "./types";

async function buildLocation(input: ImportedLocationRow): Promise<AssetLocationInput> {
    if (input.lat !== null && input.lat !== undefined && input.lng !== null && input.lng !== undefined) {
        return {
            label: input.label,
            rawAddress: input.rawAddress,
            formattedAddress: input.formattedAddress || input.rawAddress,
            lat: input.lat,
            lng: input.lng,
            isPrimary: true,
            source: "import",
            sourceRef: input.sourceRef,
            status: "geocoded",
        };
    }

    if (!hasGoogleMapsKey()) {
        return {
            label: input.label,
            rawAddress: input.rawAddress,
            formattedAddress: input.formattedAddress,
            isPrimary: true,
            source: "import",
            sourceRef: input.sourceRef,
            status: "pending",
        };
    }

    try {
        const geocoded = await geocodeAddress(input.rawAddress);
        if (!geocoded) {
            return {
                label: input.label,
                rawAddress: input.rawAddress,
                formattedAddress: input.formattedAddress,
                isPrimary: true,
                source: "import",
                sourceRef: input.sourceRef,
                status: "failed",
            };
        }

        return {
            label: input.label,
            rawAddress: input.rawAddress,
            formattedAddress: geocoded.formattedAddress,
            googlePlaceId: geocoded.placeId,
            lat: geocoded.lat,
            lng: geocoded.lng,
            isPrimary: true,
            source: "import",
            sourceRef: input.sourceRef,
            status: "geocoded",
            rawResponseJson: geocoded.rawResponseJson,
        };
    } catch {
        return {
            label: input.label,
            rawAddress: input.rawAddress,
            formattedAddress: input.formattedAddress,
            isPrimary: true,
            source: "import",
            sourceRef: input.sourceRef,
            status: "failed",
        };
    }
}

export async function importLocationsFromCsv(csvText: string) {
    const rows = parseLocationCsv(csvText);
    const summary = {
        rows: rows.length,
        imported: 0,
        unmatched: 0,
        geocoded: 0,
        pending: 0,
        failed: 0,
    };

    for (const row of rows) {
        const asset = findMediaAssetByReference({ assetId: row.assetId, objectKey: row.objectKey });
        if (!asset) {
            summary.unmatched += 1;
            continue;
        }

        const location = await buildLocation(row);
        saveImportedLocation(asset.id, asset.media_type, location);
        summary.imported += 1;

        if (location.status === "geocoded") summary.geocoded += 1;
        if (location.status === "pending") summary.pending += 1;
        if (location.status === "failed") summary.failed += 1;
    }

    return summary;
}
