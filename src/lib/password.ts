import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEYLEN = 64;

export function hashPassword(password: string) {
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, KEYLEN).toString("hex");
    return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(storedPassword: string, providedPassword: string) {
    if (!storedPassword) {
        return providedPassword === "";
    }

    // Anything not in scrypt form was never written by this app (both
    // `ensureDefaultAdmin` and `registerUser` hash on the way in), so treat it
    // as unusable rather than falling back to a plaintext comparison.
    if (!storedPassword.startsWith("scrypt$")) {
        return false;
    }

    const [, salt, storedHash] = storedPassword.split("$");
    const candidate = scryptSync(providedPassword, salt, KEYLEN);
    const expected = Buffer.from(storedHash, "hex");
    if (candidate.length !== expected.length) return false;
    return timingSafeEqual(candidate, expected);
}
