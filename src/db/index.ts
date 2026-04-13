import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";

import { ensureCmsDefaults } from "./bootstrap";

const dbPath = process.env.SQLITE_URL ?? "sqlite.db";
export const sqlite = new Database(dbPath);
const migrationDb = drizzle(sqlite);
migrate(migrationDb, { migrationsFolder: "drizzle" });

export const db = migrationDb;
ensureCmsDefaults(db);
