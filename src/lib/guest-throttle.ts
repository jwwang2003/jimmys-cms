/**
 * Guest sign-in and guest registration are deliberately unauthenticated,
 * which also makes them the two places an anonymous caller can grow the
 * users table. One shared token bucket caps both: bursts of real visitors
 * fit, a scripted loop drains it and gets 429s. In-process state is fine at
 * this scale; a restart refilling the bucket costs nothing.
 */
const BUCKET_CAPACITY = 5;
const REFILL_INTERVAL_MS = 30_000;

let tokens = BUCKET_CAPACITY;
let lastRefill = Date.now();

export function takeGuestToken() {
    const now = Date.now();
    const refilled = Math.floor((now - lastRefill) / REFILL_INTERVAL_MS);
    if (refilled > 0) {
        tokens = Math.min(BUCKET_CAPACITY, tokens + refilled);
        lastRefill = now;
    }
    if (tokens <= 0) return false;
    tokens -= 1;
    return true;
}
