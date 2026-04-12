import { NextResponse } from "next/server";

import { createPasswordlessGuest } from "@/db/operations";
import { createSessionToken } from "@/lib/session-core";
import { writeSessionCookie } from "@/lib/session";

export const runtime = "nodejs";

export async function POST() {
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
        const message = error instanceof Error ? error.message : "Unable to create guest session";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
