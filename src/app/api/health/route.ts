import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Liveness/readiness probe for Docker + the deploy workflow. Touching the DB
// proves the sqlite volume is mounted and migrations completed.
export async function GET() {
    try {
        const { sqlite } = await import("@/db");
        sqlite.prepare("select 1").get();
        return NextResponse.json({ status: "ok" });
    } catch (error) {
        return NextResponse.json(
            { status: "error", message: error instanceof Error ? error.message : "unknown" },
            { status: 503 },
        );
    }
}
