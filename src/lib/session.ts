import { cookies } from "next/headers";

export {
    createSessionToken,
    readSessionFromCookie,
    SESSION_COOKIE_NAME,
    SESSION_TTL_MS,
    verifySessionToken,
    type SessionPayload,
    type SessionRole,
} from "./session-core";

import { readSessionFromCookie, SESSION_COOKIE_NAME } from "./session-core";

export async function getCurrentSession() {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    return readSessionFromCookie(token);
}

export async function writeSessionCookie(token: string) {
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24 * 7,
    });
}

export async function clearSessionCookie() {
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, "", {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
        maxAge: 0,
    });
}
