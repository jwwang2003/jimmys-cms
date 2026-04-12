import { NextResponse } from "next/server";

import { createSessionToken } from "@/lib/session-core";
import { clearSessionCookie, writeSessionCookie } from "@/lib/session";
import { ensureDefaultAdmin, registerUser, validateLogin } from "@/db/operations";

export const runtime = "nodejs";

function badRequest(message: string, status = 400) {
    return NextResponse.json({ error: message }, { status });
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
            const user = await registerUser({ username, password, role });
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
        const message = error instanceof Error ? error.message : "Internal server error";
        return badRequest(message, 500);
    }
}
