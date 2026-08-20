import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins/username";

import { db } from "@/db";
import * as authSchema from "../../auth-schema";

// Canonical hostname this instance answers on. Unset means same-origin, which
// is correct for local development.
const baseURL = process.env.AUTH_BASE_URL || undefined;

// Every hostname that can reach the app must be listed, or Better Auth's CSRF
// origin check rejects the request.
const trustedOrigins = (process.env.AUTH_TRUSTED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

export const auth = betterAuth({
    ...(baseURL ? { baseURL } : {}),
    ...(trustedOrigins.length ? { trustedOrigins } : {}),
    database: drizzleAdapter(db, {
        provider: "sqlite",
        schema: authSchema,
    }),
    emailAndPassword: {
        enabled: true,
    },
    socialProviders: {
        // Add OAuth providers as needed
    },
    plugins: [
        username({
            minUsernameLength: 3,
            maxUsernameLength: 32,
        }),
    ],
});
