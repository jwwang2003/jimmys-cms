/**
 * Materialised geography (cms-plan.md §6).
 *
 * The map facets on country and region on every page, so these live as indexed
 * columns on the asset rather than in `media_attributes`. The EAV table is the
 * wrong shape for that query: it costs a join and a row-per-attribute scan
 * where a column costs an index seek.
 *
 * Geocode results are the intended source. Until a Google Maps key is
 * configured, `countryCodeFromName` covers the authored country names, which
 * are a closed set in this catalog.
 */

/**
 * Country names as they appear in the source spreadsheets, mapped to ISO
 * 3166-1 alpha-2. Bilingual because the sheets are.
 */
const COUNTRY_NAME_TO_CODE: Record<string, string> = {
    "中国": "CN",
    "中华人民共和国": "CN",
    china: "CN",
    canada: "CA",
    "加拿大": "CA",
    panama: "PA",
    "巴拿马": "PA",
    italy: "IT",
    italia: "IT",
    "意大利": "IT",
    japan: "JP",
    "日本": "JP",
    "united states": "US",
    "united states of america": "US",
    usa: "US",
    "美国": "US",
    russia: "RU",
    "俄罗斯": "RU",
    france: "FR",
    "法国": "FR",
};

export function countryCodeFromName(name: string | null | undefined): string | null {
    if (!name) return null;
    const normalized = name.trim();
    if (!normalized) return null;
    // Already a code.
    if (/^[A-Z]{2}$/.test(normalized)) return normalized;
    return COUNTRY_NAME_TO_CODE[normalized.toLocaleLowerCase()] ?? COUNTRY_NAME_TO_CODE[normalized] ?? null;
}

type AddressComponent = {
    short_name?: string;
    long_name?: string;
    types?: string[];
};

/**
 * Pull ISO country and region codes out of a stored Google geocode response.
 *
 * Google returns the region as a bare subdivision code (`ON`, `SH`), while the
 * site catalog and the map both key on the ISO 3166-2 form (`CA-ON`, `CN-SH`),
 * so the country is prefixed here rather than left for each caller to remember.
 */
export function geographyFromGeocodeResponse(rawResponseJson: string | null | undefined): {
    countryCode: string | null;
    regionCode: string | null;
} {
    if (!rawResponseJson) return { countryCode: null, regionCode: null };

    let parsed: unknown;
    try {
        parsed = JSON.parse(rawResponseJson);
    } catch {
        return { countryCode: null, regionCode: null };
    }

    const container = parsed as { address_components?: AddressComponent[]; results?: Array<{ address_components?: AddressComponent[] }> };
    const components = container.address_components ?? container.results?.[0]?.address_components;
    if (!Array.isArray(components)) return { countryCode: null, regionCode: null };

    let countryCode: string | null = null;
    let regionShort: string | null = null;

    for (const component of components) {
        const types = component.types ?? [];
        if (types.includes("country") && component.short_name) {
            countryCode = component.short_name.toUpperCase();
        }
        if (types.includes("administrative_area_level_1") && component.short_name) {
            regionShort = component.short_name;
        }
    }

    if (!regionShort) return { countryCode, regionCode: null };

    // Already fully qualified.
    if (/^[A-Z]{2}-/.test(regionShort)) return { countryCode, regionCode: regionShort };
    return {
        countryCode,
        regionCode: countryCode ? `${countryCode}-${regionShort}` : null,
    };
}
