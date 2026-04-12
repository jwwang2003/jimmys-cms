import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/session-core";

const LOGIN_ROUTE = "/login";

export async function middleware(request: NextRequest) {
    if (request.cookies.get(SESSION_COOKIE_NAME)?.value) {
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
