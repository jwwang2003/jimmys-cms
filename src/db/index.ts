// import 'server-only';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';

// Initialize the SQLite database
const dbPath = process.env.SQLITE_URL ?? 'sqlite.db';
const sqlite = new Database(dbPath);
export const db = drizzle(sqlite);
