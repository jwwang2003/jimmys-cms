export type SessionRole = "admin" | "user" | "guest";

export type SessionPayload = {
    userId: string;
    role: SessionRole;
    username: string;
    exp: number;
};

export const SESSION_COOKIE_NAME = "cms_session";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

function getSessionSecret() {
    return process.env.SESSION_SECRET || "dev-session-secret-change-me";
}

function base64UrlEncode(value: string | Uint8Array) {
    const input = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
    return input
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    return Buffer.from(padded, "base64");
}

async function signMessage(message: string) {
    const keyData = new TextEncoder().encode(getSessionSecret());
    const key = await crypto.subtle.importKey(
        "raw",
        keyData,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
    return base64UrlEncode(new Uint8Array(signature));
}

export async function createSessionToken(input: Omit<SessionPayload, "exp"> & { exp?: number }) {
    const payload: SessionPayload = {
        ...input,
        exp: input.exp ?? Date.now() + SESSION_TTL_MS,
    };
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signature = await signMessage(encodedPayload);
    return `${encodedPayload}.${signature}`;
}

export async function verifySessionToken(token: string): Promise<SessionPayload> {
    const [encodedPayload, suppliedSignature] = token.split(".");
    if (!encodedPayload || !suppliedSignature) {
        throw new Error("Invalid session token");
    }

    const expectedSignature = await signMessage(encodedPayload);
    if (expectedSignature !== suppliedSignature) {
        throw new Error("Invalid session signature");
    }

    const payload = JSON.parse(base64UrlDecode(encodedPayload).toString("utf8")) as SessionPayload;
    if (!payload.userId || !payload.role || !payload.username) {
        throw new Error("Invalid session payload");
    }
    if (payload.exp <= Date.now()) {
        throw new Error("Session expired");
    }
    return payload;
}

export async function readSessionFromCookie(token: string | undefined) {
    if (!token) return null;
    try {
        return await verifySessionToken(token);
    } catch {
        return null;
    }
}
