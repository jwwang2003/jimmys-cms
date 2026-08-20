import { NextResponse } from "next/server";

import { takeGuestToken } from "@/lib/guest-throttle";
import { createSessionToken } from "@/lib/session-core";
import { clearSessionCookie, writeSessionCookie } from "@/lib/session";
import { ensureDefaultAdmin, registerUser, validateLogin } from "@/db/operations";

export const runtime = "nodejs";

function badRequest(message: string, status = 400) {
    return NextResponse.json({ error: message }, { status });
}

/**
 * Editor accounts ("user" role) can upload, delete, and publish media, so an
 * internet-facing instance must not hand them out to anyone who finds /login.
 * Guests stay open: they are read-only by construction.
 */
function editorRegistrationAllowed() {
    if (process.env.ALLOW_PUBLIC_REGISTRATION === "1") return true;
    return process.env.NODE_ENV !== "production";
}

export async function POST(request: Request) {
    try {
        await ensureDefaultAdmin();
        const body = await request.json();
        const action = String(body.action || "login").toLowerCase();

        if (action === "logout") {
            await clearSessionCookie();
            return NextResponse.json({ ok: true });
        }

        if (action === "register") {
            const username = String(body.username || "");
            const role = body.role === "guest" ? "guest" : "user";
            const password = String(body.password || "");
            if (role === "user" && !editorRegistrationAllowed()) {
                return badRequest("Registration is disabled on this instance", 403);
            }
            // Guest registration shares the guest sign-in throttle: both are
            // unauthenticated inserts into the users table.
            if (role === "guest" && !takeGuestToken()) {
                return badRequest("Too many guest sign-ins right now; try again in a minute", 429);
            }
            let user;
            try {
                user = await registerUser({ username, password, role });
            } catch (error) {
                // registerUser only throws validation failures (taken username,
                // short password), which are the caller's to fix.
                return badRequest(error instanceof Error ? error.message : "Could not register", 400);
            }
            const token = await createSessionToken({
                userId: user.id,
                username: user.username || user.name,
                role: user.role as "admin" | "user" | "guest",
            });
            await writeSessionCookie(token);
            return NextResponse.json({
                ok: true,
                user: { id: user.id, username: user.username, role: user.role },
            });
        }

        const username = String(body.username || "");
        const password = String(body.password || "");
        if (!username.trim()) {
            return badRequest("Missing username");
        }

        const user = await validateLogin(username, password);
        if (!user) {
            return badRequest("Invalid username or password", 401);
        }

        const token = await createSessionToken({
            userId: user.id,
            username: user.username || user.name,
            role: user.role as "admin" | "user" | "guest",
        });
        await writeSessionCookie(token);

        return NextResponse.json({
            ok: true,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
            },
        });
    } catch (error) {
        // Unexpected failures (database, JSON parse) log server-side; the
        // response stays generic so internals never reach the login form.
        console.error("[login] unexpected failure:", error);
        return badRequest("Internal server error", 500);
    }
}
