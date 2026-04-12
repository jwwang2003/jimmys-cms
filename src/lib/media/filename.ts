export type ParsedBatchFilename = {
    id: string;
    name: string;
    date: string;
    ext: string;
    parsedDate: Date;
};

const FILENAME_V1_REGEX = /^([^+]+)\+([^+]+)\+([^.]+)\.([a-z0-9]+)$/i;

export function parseBatchFilename(input: string): ParsedBatchFilename {
    if (typeof input !== "string" || input.trim().length === 0) {
        throw new TypeError("parseBatchFilename: input must be a non-empty string");
    }

    const match = input.match(FILENAME_V1_REGEX);
    if (!match) {
        throw new Error(
            "parseBatchFilename: invalid filename format, expected '<id>+<name>+YYYYMMDD.<ext>'"
        );
    }

    const [, id, rawName, date, ext] = match;
    if (!/^\d{8}$/.test(date)) {
        throw new Error("parseBatchFilename: invalid date values in filename");
    }

    const year = Number(date.slice(0, 4));
    const month = Number(date.slice(4, 6));
    const day = Number(date.slice(6, 8));
    const parsedDate = new Date(year, month - 1, day);
    const isValidDate =
        parsedDate.getFullYear() === year &&
        parsedDate.getMonth() === month - 1 &&
        parsedDate.getDate() === day;

    if (!isValidDate) {
        throw new Error("parseBatchFilename: invalid calendar date in filename");
    }

    return {
        id,
        name: rawName.replace(/[_-]+/g, " ").trim(),
        date,
        ext: ext.toLowerCase(),
        parsedDate,
    };
}
