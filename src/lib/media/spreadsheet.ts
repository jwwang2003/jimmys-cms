import * as XLSX from "xlsx";

function splitList(value: string | undefined) {
    return String(value || "")
        .split(/[;,，]/)
        .map((item) => item.trim())
        .filter(Boolean);
}

function parseOptionalNumber(value: unknown) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function formatExcelDate(value: unknown) {
    if (value === null || value === undefined || value === "") return undefined;
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
    }
    if (typeof value === "number") {
        const parsed = XLSX.SSF.parse_date_code(value);
        if (!parsed) return String(value);
        const month = String(parsed.m).padStart(2, "0");
        const day = String(parsed.d).padStart(2, "0");
        return `${parsed.y}-${month}-${day}`;
    }
    const text = String(value).trim();
    return text || undefined;
}

function cellToString(value: unknown) {
    if (value === null || value === undefined) return "";
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).trim();
}

function normalizeHeaderKey(value: unknown) {
    return cellToString(value)
        .normalize("NFKC")
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[_/\\\-()[\]{}:：]/g, "");
}

const HEADER_ALIASES: Record<string, string> = {
    assetid: "asset_id",
    id: "asset_id",
    imageid: "asset_id",
    videoid: "asset_id",
    mediaid: "asset_id",
    objectkey: "object_key",
    key: "object_key",
    s3key: "object_key",
    filename: "file_name",
    filenameext: "file_name",
    name: "file_name",
    文件名: "file_name",
    作品编号: "external_id",
    編號: "external_id",
    编号: "external_id",
    externalid: "external_id",
    referenceid: "external_id",
    日期yyyymmdd: "date",
    日期: "date",
    date: "date",
    country: "country",
    国家: "country",
    city: "city",
    城市: "city",
    place: "place",
    地点: "place",
    坐标: "address",
    address: "address",
    rawaddress: "address",
    formattedaddress: "formatted_address",
    lat: "lat",
    latitude: "lat",
    lng: "lng",
    longitude: "lng",
    title: "title",
    标题: "title",
    description: "description",
    描述: "description",
    tags: "tags",
    tag: "tags",
    style: "tags",
    标签风格: "tags",
    标签: "tags",
    album: "collections",
    albums: "collections",
    collection: "collections",
    collections: "collections",
    相册: "collections",
    合集: "collections",
    摄影信息: "camera",
    camera: "camera",
    主要绘画工具: "tool",
    tool: "tool",
    原作出处: "source_work",
    source: "source_work",
    sourcework: "source_work",
};

const KNOWN_HEADERS = new Set(Object.keys(HEADER_ALIASES));

function resolveCanonicalHeader(value: unknown) {
    const normalized = normalizeHeaderKey(value);
    return HEADER_ALIASES[normalized] || normalized;
}

function scoreHeaderRow(row: unknown[]) {
    return row.reduce<number>((score, cell) => {
        const normalized = normalizeHeaderKey(cell);
        return score + (KNOWN_HEADERS.has(normalized) ? 1 : 0);
    }, 0);
}

function pickHeaderRow(rows: unknown[][]) {
    let bestIndex = 0;
    let bestScore = -1;

    rows.forEach((row, index) => {
        const score = scoreHeaderRow(row);
        if (score > bestScore) {
            bestScore = score;
            bestIndex = index;
        }
    });

    return bestIndex;
}

function buildRawAddress(record: Record<string, string>) {
    return (
        record.address ||
        record.formatted_address ||
        [record.place, record.city, record.country].filter(Boolean).join(", ")
    );
}

export type ParsedMetadataRow = {
    sourceFile: string;
    sheetName: string;
    rowNumber: number;
    sourceRef: string;
    assetId: number | null;
    objectKey: string | null;
    fileName: string | null;
    externalId: string | null;
    title?: string;
    description?: string;
    date?: string;
    country?: string;
    city?: string;
    locationLabel?: string;
    rawAddress?: string;
    formattedAddress?: string;
    lat?: number | null;
    lng?: number | null;
    camera?: string;
    tool?: string;
    sourceWork?: string;
    tagSlugs: string[];
    collectionNames: string[];
    raw: Record<string, string>;
};

export type ParsedMetadataSpreadsheet = {
    fileName: string;
    sheets: string[];
    rows: ParsedMetadataRow[];
};

function parseSheetRows(fileName: string, sheetName: string, rows: unknown[][]) {
    if (rows.length === 0) return [];

    const headerIndex = pickHeaderRow(rows);
    const headers = rows[headerIndex].map((cell) => resolveCanonicalHeader(cell));
    const parsedRows: ParsedMetadataRow[] = [];

    for (let i = headerIndex + 1; i < rows.length; i += 1) {
        const values = rows[i];
        const record = Object.fromEntries(headers.map((header, index) => [header, cellToString(values[index])]));

        const assetId = parseOptionalNumber(record.asset_id);
        const objectKey = record.object_key || null;
        const fileNameValue = record.file_name || null;
        const externalId = record.external_id || null;
        const rawAddress = buildRawAddress(record);

        if (!assetId && !objectKey && !fileNameValue && !externalId) {
            continue;
        }

        parsedRows.push({
            sourceFile: fileName,
            sheetName,
            rowNumber: i + 1,
            sourceRef: `${fileName}:${sheetName}:${i + 1}`,
            assetId,
            objectKey,
            fileName: fileNameValue,
            externalId,
            title: record.title || undefined,
            description: record.description || undefined,
            date: formatExcelDate(values[headers.indexOf("date")]),
            country: record.country || undefined,
            city: record.city || undefined,
            locationLabel: record.place || undefined,
            rawAddress: rawAddress || undefined,
            formattedAddress: record.formatted_address || undefined,
            lat: parseOptionalNumber(record.lat),
            lng: parseOptionalNumber(record.lng),
            camera: record.camera || undefined,
            tool: record.tool || undefined,
            sourceWork: record.source_work || undefined,
            tagSlugs: splitList(record.tags),
            collectionNames: splitList(record.collections),
            raw: record,
        });
    }

    return parsedRows;
}

export function parseMetadataSpreadsheet(input: {
    fileName: string;
    bytes: Buffer | Uint8Array;
}) : ParsedMetadataSpreadsheet {
    const lowerName = input.fileName.toLowerCase();
    const isCsv = lowerName.endsWith(".csv");
    const workbook = XLSX.read(
        isCsv ? Buffer.from(input.bytes).toString("utf8") : Buffer.from(input.bytes),
        isCsv ? { type: "string", raw: true, dense: true } : { type: "buffer", raw: true, dense: true }
    );

    const rows: ParsedMetadataRow[] = [];
    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const sheetRows = XLSX.utils.sheet_to_json(sheet, {
            header: 1,
            raw: true,
            defval: "",
            blankrows: false,
        }) as unknown[][];

        rows.push(...parseSheetRows(input.fileName, sheetName, sheetRows));
    }

    return {
        fileName: input.fileName,
        sheets: workbook.SheetNames,
        rows,
    };
}
