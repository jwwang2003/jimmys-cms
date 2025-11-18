import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const LOGIN_ROUTE = "/login";
const SESSION_ENDPOINT = "/api/auth/get-session";

type SessionResponse = {
    session?: Record<string, unknown>;
    user?: Record<string, unknown>;
} | null;

async function hasSession(request: NextRequest): Promise<boolean> {
    try {
        const sessionUrl = new URL(SESSION_ENDPOINT, request.nextUrl.origin);
        const cookie = request.headers.get("cookie");
        const res = await fetch(sessionUrl, {
            headers: cookie ? { cookie } : {},
            cache: "no-store",
        });
        if (!res.ok) return false;
        const data = (await res.json().catch(() => null)) as SessionResponse;
        return Boolean(data?.session && data?.user);
    } catch {
        return false;
    }
}

export async function middleware(request: NextRequest) {
    if (await hasSession(request)) {
        return NextResponse.next();
    }

    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = LOGIN_ROUTE;
    loginUrl.searchParams.set("redirectTo", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
}

export const config = {
    matcher: ["/admin/:path*", "/server-only/:path*"],
};
