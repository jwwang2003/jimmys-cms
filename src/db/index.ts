import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";

import { ensureCmsDefaults } from "./bootstrap";

const dbPath = process.env.SQLITE_URL ?? "sqlite.db";
export const sqlite = new Database(dbPath);
ensureCmsDefaults(sqlite);

export const db = drizzle(sqlite);
