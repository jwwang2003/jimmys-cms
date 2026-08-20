import { S3Client } from "@aws-sdk/client-s3";

type BucketEntry = {
    name: string;
    region: string;
    /** Custom S3 API endpoint. Empty means AWS. */
    endpoint: string;
    /** Path-style addressing (`<endpoint>/<bucket>/<key>`). */
    forcePathStyle: boolean;
    /** Explicit credentials. Undefined defers to the SDK's default chain. */
    credentials?: { accessKeyId: string; secretAccessKey: string };
    /** Public base URL derivatives are served from, if any. */
    cdnBaseUrl: string;
};

// Default region and bucket (back-compat)
export const region = process.env.AWS_REGION || "";
export const bucket = process.env.S3_BUCKET || "";

// Prefixes kept as-is
export const prefixes = {
    content: process.env.CONTENT_PREFIX || "content",
    media: process.env.MEDIA_PREFIX || "media",
    public: process.env.PUBLIC_PREFIX || "public",
    meta: process.env.META_PREFIX || "meta",
};

const env = (key: string) => (process.env[key] || "").trim();

/**
 * R2 speaks the S3 API, so it is reached by pointing the same client at a
 * different endpoint rather than by a separate code path. The account-scoped
 * host is derivable from the account id, so `R2_ACCOUNT_ID` alone is enough.
 */
function r2Endpoint() {
    const explicit = env("R2_ENDPOINT");
    if (explicit) return explicit;
    const accountId = env("R2_ACCOUNT_ID");
    return accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "";
}

function readCredentials(suffix: string) {
    const accessKeyId = env(`S3_ACCESS_KEY_ID${suffix}`);
    const secretAccessKey = env(`S3_SECRET_ACCESS_KEY${suffix}`);
    if (accessKeyId && secretAccessKey) return { accessKeyId, secretAccessKey };
    return undefined;
}

// Build a registry of named buckets from env vars.
// Supports:
// - S3_BUCKET for default bucket (alias: "default")
// - S3_BUCKET_<ALIAS>=bucket-name with optional S3_REGION_<ALIAS>,
//   S3_ENDPOINT_<ALIAS>, S3_ACCESS_KEY_ID_<ALIAS>,
//   S3_SECRET_ACCESS_KEY_<ALIAS>, S3_CDN_BASE_URL_<ALIAS>
// - Falls back to AWS_REGION when per-alias region not present
const bucketRegistry: Record<string, BucketEntry> = {};

const putBucket = (
    alias: string,
    name?: string | null,
    reg?: string | null,
    options?: Partial<Omit<BucketEntry, "name" | "region">>
) => {
    if (!name) return;
    const key = alias.toLowerCase();
    const resolvedRegion = (reg || region || "").trim();
    bucketRegistry[key] = {
        name: name.trim(),
        region: resolvedRegion,
        endpoint: options?.endpoint || "",
        forcePathStyle: options?.forcePathStyle ?? false,
        credentials: options?.credentials,
        cdnBaseUrl: options?.cdnBaseUrl || "",
    };
};

// Default alias
if (bucket) {
    putBucket("default", bucket, region, {
        endpoint: env("S3_ENDPOINT"),
        forcePathStyle: env("S3_FORCE_PATH_STYLE") === "1",
        credentials: readCredentials(""),
        cdnBaseUrl: env("S3_CDN_BASE_URL"),
    });
}

// Discover S3_BUCKET_<ALIAS>
for (const [envKey, envVal] of Object.entries(process.env)) {
    const m = envKey.match(/^S3_BUCKET_([A-Z0-9_]+)$/);
    if (m) {
        const alias = m[1];
        const perRegion = env(`S3_REGION_${alias}`) || env(`AWS_REGION_${alias}`) || region;
        putBucket(alias, envVal || undefined, perRegion || undefined, {
            endpoint: env(`S3_ENDPOINT_${alias}`),
            forcePathStyle: env(`S3_FORCE_PATH_STYLE_${alias}`) === "1",
            credentials: readCredentials(`_${alias}`),
            cdnBaseUrl: env(`S3_CDN_BASE_URL_${alias}`),
        });
    }
}

/**
 * R2 aliases declared the short way: `R2_BUCKET_<ALIAS>` inherits the account
 * endpoint and the shared `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` token, so
 * a second bucket on the same account costs one line instead of five.
 * An explicit `S3_BUCKET_<ALIAS>` for the same alias wins.
 */
for (const [envKey, envVal] of Object.entries(process.env)) {
    const m = envKey.match(/^R2_BUCKET_([A-Z0-9_]+)$/);
    if (!m || !envVal) continue;
    const alias = m[1];
    if (bucketRegistry[alias.toLowerCase()]) continue;
    const endpoint = env(`R2_ENDPOINT_${alias}`) || r2Endpoint();
    if (!endpoint) continue;
    const accessKeyId = env(`R2_ACCESS_KEY_ID_${alias}`) || env("R2_ACCESS_KEY_ID");
    const secretAccessKey = env(`R2_SECRET_ACCESS_KEY_${alias}`) || env("R2_SECRET_ACCESS_KEY");
    putBucket(alias, envVal, "auto", {
        endpoint,
        // R2 accepts virtual-hosted addressing, but the account-scoped host is
        // the documented path-style form and avoids a per-bucket DNS label.
        forcePathStyle: true,
        credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
        cdnBaseUrl: env(`R2_CDN_BASE_URL_${alias}`),
    });
}

// Expose buckets map
export const buckets: Record<string, BucketEntry> = bucketRegistry;

// Memoize clients. The key must cover every field that changes client
// behaviour: two aliases sharing a region but differing in endpoint or
// credentials are different clients, and keying on region alone would hand the
// second one the first one's connection.
const clientCache = new Map<string, S3Client>();

function clientFor(entry: Pick<BucketEntry, "region" | "endpoint" | "forcePathStyle" | "credentials">) {
    const reg = entry.region || region || "";
    const cacheKey = [
        reg,
        entry.endpoint,
        entry.forcePathStyle ? "path" : "host",
        entry.credentials?.accessKeyId || "",
    ].join("|");

    let client = clientCache.get(cacheKey);
    if (!client) {
        client = new S3Client({
            region: reg || undefined,
            ...(entry.endpoint ? { endpoint: entry.endpoint, forcePathStyle: entry.forcePathStyle } : {}),
            ...(entry.credentials ? { credentials: entry.credentials } : {}),
        });
        clientCache.set(cacheKey, client);
    }
    return client;
}

export function getS3(alias = "default"): {
    client: S3Client;
    bucket: string;
    region: string;
    endpoint: string;
    cdnBaseUrl: string;
} {
    const entry = buckets[alias.toLowerCase()];
    const selected =
        entry ||
        (bucket
            ? {
                  name: bucket,
                  region: region || "",
                  endpoint: "",
                  forcePathStyle: false,
                  credentials: undefined,
                  cdnBaseUrl: "",
              }
            : undefined);
    if (!selected) {
        throw new Error(`No S3 bucket configured for alias "${alias}"`);
    }
    const reg = selected.region || region || "";
    return {
        client: clientFor(selected),
        bucket: selected.name,
        region: reg,
        endpoint: selected.endpoint,
        cdnBaseUrl: selected.cdnBaseUrl,
    };
}

// Back-compat single client (uses default region)
export const s3 = new S3Client({ region: region || undefined });

// CloudFront distribution ids.
// Legacy: the CMS originally targeted AWS S3 + CloudFront. Cloudflare R2 with a
// custom domain on the bucket serves the same role now (see cms-plan.md §3), so
// these stay only for buckets that are still behind CloudFront.
export const cfDistId = process.env.CLOUDFRONT_DISTRIBUTION_ID || "";
export const cfDistributions: Record<string, string> = (() => {
    const out: Record<string, string> = {};
    if (cfDistId) out["default"] = cfDistId;
    for (const [envKey, envVal] of Object.entries(process.env)) {
        const m = envKey.match(/^CLOUDFRONT_DISTRIBUTION_ID_([A-Z0-9_]+)$/);
        if (m && envVal) out[m[1].toLowerCase()] = envVal;
    }
    return out;
})();

// Helper to build a namespaced key with a known prefix
export function buildKey(prefix: keyof typeof prefixes, ...parts: string[]) {
    const p = prefixes[prefix];
    const suffix = parts
        .filter(Boolean)
        .map((s) => s.replace(/^\/+|\/+$/g, ""))
        .join("/");
    return [p, suffix].filter(Boolean).join("/");
}
