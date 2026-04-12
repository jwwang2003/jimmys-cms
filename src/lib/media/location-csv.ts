export type ImportedLocationRow = {
    assetId: number | null;
    objectKey: string | null;
    rawAddress: string;
    label?: string;
    formattedAddress?: string;
    lat?: number | null;
    lng?: number | null;
    sourceRef?: string;
};

function parseNumber(value: string | undefined) {
    if (!value) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseCsvLine(line: string) {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        if (char === "\"") {
            if (inQuotes && line[i + 1] === "\"") {
                current += "\"";
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }
        if (char === "," && !inQuotes) {
            values.push(current.trim());
            current = "";
            continue;
        }
        current += char;
    }

    values.push(current.trim());
    return values;
}

export function parseLocationCsv(csvText: string): ImportedLocationRow[] {
    const lines = csvText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    if (lines.length === 0) return [];

    const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase());
    const rows: ImportedLocationRow[] = [];

    for (const line of lines.slice(1)) {
        const values = parseCsvLine(line);
        const record = Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
        const assetId = parseNumber(record.asset_id || record.image_id || record.id);
        const objectKey = String(record.object_key || record.key || "").trim() || null;
        const rawAddress = String(record.address || record.raw_address || "").trim();
        if (!rawAddress) continue;

        rows.push({
            assetId,
            objectKey,
            rawAddress,
            label: String(record.label || "").trim() || undefined,
            formattedAddress: String(record.formatted_address || "").trim() || undefined,
            lat: parseNumber(record.lat || record.latitude),
            lng: parseNumber(record.lng || record.longitude),
            sourceRef: String(record.source_ref || record.row_id || "").trim() || undefined,
        });
    }

    return rows;
}
