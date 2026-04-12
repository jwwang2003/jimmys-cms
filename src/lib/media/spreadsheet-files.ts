import { promises as fs } from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const SUPPORTED_EXTENSIONS = new Set([".csv", ".xlsx", ".xls"]);

export async function listSpreadsheetImportFiles() {
    try {
        const entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
        return entries
            .filter((entry) => entry.isFile())
            .filter((entry) => SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
            .map((entry) => entry.name)
            .sort((a, b) => a.localeCompare(b));
    } catch {
        return [];
    }
}

export async function readSpreadsheetImportFile(fileName: string) {
    const safeName = path.basename(fileName);
    const fullPath = path.join(DATA_DIR, safeName);
    const resolved = path.resolve(fullPath);
    const resolvedDataDir = path.resolve(DATA_DIR);

    if (!resolved.startsWith(resolvedDataDir)) {
        throw new Error("Invalid import file path");
    }

    return {
        fileName: safeName,
        bytes: await fs.readFile(resolved),
    };
}
