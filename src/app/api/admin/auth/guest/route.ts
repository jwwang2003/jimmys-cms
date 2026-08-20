import { NextResponse } from "next/server";

import { createPasswordlessGuest } from "@/db/operations";
import { takeGuestToken } from "@/lib/guest-throttle";
import { createSessionToken } from "@/lib/session-core";
import { writeSessionCookie } from "@/lib/session";

export const runtime = "nodejs";

export async function POST() {
    if (!takeGuestToken()) {
        return NextResponse.json(
            { error: "Too many guest sign-ins right now; try again in a minute" },
            { status: 429 }
        );
    }
    try {
        const guest = await createPasswordlessGuest();
        const token = await createSessionToken({
            userId: guest.id,
            username: guest.username || guest.name,
            role: "guest",
        });
        await writeSessionCookie(token);
        return NextResponse.json({
            ok: true,
            user: { id: guest.id, username: guest.username, role: guest.role },
        });
    } catch (error) {
        console.error("[guest] session creation failed:", error);
        return NextResponse.json({ error: "Unable to create guest session" }, { status: 500 });
    }
}
