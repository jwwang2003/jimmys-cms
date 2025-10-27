import { defineConfig } from "drizzle-kit";
import dotenv from "dotenv";

// Load env files similarly to Next.js order
(() => {
    const env = process.env.NODE_ENV ?? "development";
    const order = [
        `.env.${env}.local`,
        `.env.${env}`,
        `.env.local`,
        `.env`,
    ];
    for (const file of order) {
        dotenv.config({ path: file, override: true });
    }
})();

export default defineConfig({
    dialect: "sqlite",
    schema: ["./src/db/schema", "./auth-schema.ts"],
    dbCredentials: {
        // For SQLite, Drizzle Kit expects a filesystem path
        url: process.env.SQLITE_URL!,
    },
});
