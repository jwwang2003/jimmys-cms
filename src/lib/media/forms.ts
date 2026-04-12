import type { AssetUpdateInput } from "./types";

function splitCsv(input: unknown) {
    if (Array.isArray(input)) {
        return input.map((item) => String(item).trim()).filter(Boolean);
    }
    return String(input || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function parseOptionalNumber(value: unknown) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeAssetUpdatePayload(input: Record<string, unknown>): AssetUpdateInput {
    const rawAddress = String(input.rawAddress || "").trim();
    const formattedAddress = String(input.formattedAddress || "").trim();
    const lat = parseOptionalNumber(input.lat);
    const lng = parseOptionalNumber(input.lng);
    const shouldCreateLocation = Boolean(rawAddress || formattedAddress || lat !== null || lng !== null);

    return {
        title: String(input.title || "").trim() || undefined,
        description: String(input.description || "").trim() || null,
        visibility: (input.visibility as AssetUpdateInput["visibility"]) || undefined,
        status: (input.status as AssetUpdateInput["status"]) || undefined,
        tagSlugs: splitCsv(input.tagSlugs),
        collectionNames: splitCsv(input.collectionNames),
        locations: shouldCreateLocation
            ? [
                  {
                      rawAddress: rawAddress || undefined,
                      formattedAddress: formattedAddress || undefined,
                      lat,
                      lng,
                      isPrimary: true,
                      source: "manual",
                      status: lat !== null && lng !== null ? "geocoded" : "pending",
                  },
              ]
            : [],
    };
}
