import path from "node:path";

const SUPPORTED_SPREADSHEET_EXTENSIONS = new Set([".csv", ".xlsx", ".xls"]);

export async function readSpreadsheetUpload(file: File) {
    const fileName = path.basename(String(file.name || "")).trim();
    const extension = path.extname(fileName).toLowerCase();

    if (!fileName) {
        throw new Error("Missing spreadsheet file upload");
    }
    if (!SUPPORTED_SPREADSHEET_EXTENSIONS.has(extension)) {
        throw new Error("Unsupported spreadsheet file type");
    }
    if (file.size <= 0) {
        throw new Error("Spreadsheet file is empty");
    }

    return {
        fileName,
        bytes: Buffer.from(await file.arrayBuffer()),
    };
}
