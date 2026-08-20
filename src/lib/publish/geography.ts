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
 * Google's `administrative_area_level_1.short_name` is a real ISO 3166-2
 * subdivision code only in some countries — `ON`, `NY`, `IDF` — and elsewhere
 * it is a name, in whichever language the response came back in. This catalog
 * alone contains the same province under two spellings more than once:
 * `Shanghai` and `Shang Hai Shi`, `Guangdong Province` and `Guang Dong Sheng`,
 * `Lombardia` and `Lombardy`.
 *
 * Left alone that produces codes like `CN-Shang Hai Shi`, which are not ISO,
 * do not match the region codes the site's map keys on, and split one province
 * across two facet buckets.
 *
 * So names are normalised and looked up per country. Anything unmapped returns
 * null rather than a guess: an absent region drops the asset out of region
 * filters, where a wrong one silently files it under the wrong place.
 */
function normalizeRegionName(value: string) {
    return value
        .normalize("NFD")
        // Strip combining marks so "Panamá" and "Panama" agree.
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        // Administrative nouns carry no information and vary by response language.
        .replace(/\b(provincia|province|prefecture|region|sheng|shi|oblast|city)\b/g, "")
        .replace(/\bde\b/g, "")
        // Collapse everything: the transliterated forms differ only by spacing
        // ("shang hai" vs "shanghai").
        .replace(/[^a-z0-9]/g, "");
}

const REGION_NAME_TO_ISO: Record<string, string> = {
    // China
    "CN:shanghai": "CN-SH",
    "CN:guangdong": "CN-GD",
    "CN:zhejiang": "CN-ZJ",
    "CN:jiangsu": "CN-JS",
    "CN:shandong": "CN-SD",
    "CN:shanxi": "CN-SX",
    "CN:beijing": "CN-BJ",
    "CN:chongqing": "CN-CQ",
    "CN:hunan": "CN-HN",
    // Italy — Italian and English forms both appear.
    "IT:lombardia": "IT-25",
    "IT:lombardy": "IT-25",
    "IT:toscana": "IT-52",
    "IT:tuscany": "IT-52",
    "IT:veneto": "IT-34",
    // Panama
    "PA:panamaoeste": "PA-10",
    "PA:panama": "PA-8",
    "PA:cocle": "PA-2",
    // Japan
    "JP:tokyo": "JP-13",
    "JP:yamagata": "JP-06",
    // Russia
    "RU:sanktpeterburg": "RU-SPE",
    "RU:saintpetersburg": "RU-SPE",
};

/**
 * Cities whose province is unambiguous, for the responses that come back with a
 * locality but no `administrative_area_level_1` at all — a city-level result.
 *
 * This is a lookup table, not an inference: Guangzhou is in Guangdong as a fact
 * of administrative geography, not as a guess from the name. Anything not
 * listed still resolves to null.
 */
const CITY_TO_REGION: Record<string, string> = {
    "CN:guangzhou": "CN-GD",
    "CN:hangzhou": "CN-ZJ",
    "CN:yuncheng": "CN-SX",
    "CN:wanrong": "CN-SX",
    "CN:lijiang": "CN-YN",
};

/**
 * True when Google already handed back an ISO 3166-2 suffix rather than a name.
 * Real suffixes are short and uppercase (`ON`, `NY`, `IDF`, `25`).
 */
function looksLikeIsoSuffix(value: string) {
    return /^[A-Z0-9]{1,3}$/.test(value);
}

export function regionCodeFrom(countryCode: string | null, adminAreaShortName: string | null | undefined) {
    if (!countryCode || !adminAreaShortName) return null;
    const raw = adminAreaShortName.trim();
    if (!raw) return null;

    if (/^[A-Z]{2}-/.test(raw)) return raw;
    if (looksLikeIsoSuffix(raw)) return `${countryCode}-${raw}`;

    return REGION_NAME_TO_ISO[`${countryCode}:${normalizeRegionName(raw)}`] ?? null;
}

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
    let locality: string | null = null;

    for (const component of components) {
        const types = component.types ?? [];
        if (types.includes("country") && component.short_name) {
            countryCode = component.short_name.toUpperCase();
        }
        if (types.includes("administrative_area_level_1") && component.short_name) {
            regionShort = component.short_name;
        }
        if (types.includes("locality") && component.long_name) {
            locality = component.long_name;
        }
    }

    const regionCode = regionCodeFrom(countryCode, regionShort);
    if (regionCode) return { countryCode, regionCode };

    // A city-level result has no province of its own. Fall back to the city
    // only where the mapping is a matter of record.
    if (countryCode && locality) {
        const fromCity = CITY_TO_REGION[`${countryCode}:${normalizeRegionName(locality)}`];
        if (fromCity) return { countryCode, regionCode: fromCity };
    }

    return { countryCode, regionCode: null };
}
