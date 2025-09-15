import { S3Client } from "@aws-sdk/client-s3";

type BucketEntry = { name: string; region: string };

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

// Build a registry of named buckets from env vars.
// Supports:
// - S3_BUCKET for default bucket (alias: "default")
// - S3_BUCKET_<ALIAS>=bucket-name with optional S3_REGION_<ALIAS>
// - Falls back to AWS_REGION when per-alias region not present
const bucketRegistry: Record<string, BucketEntry> = {};

const putBucket = (alias: string, name?: string | null, reg?: string | null) => {
    if (!name) return;
    const key = alias.toLowerCase();
    const resolvedRegion = (reg || region || "").trim();
    bucketRegistry[key] = { name: name.trim(), region: resolvedRegion };
};

// Default alias
if (bucket) putBucket("default", bucket, region);

// Discover S3_BUCKET_<ALIAS>
for (const [envKey, envVal] of Object.entries(process.env)) {
    const m = envKey.match(/^S3_BUCKET_([A-Z0-9_]+)$/);
    if (m) {
        const alias = m[1];
        const perRegion = process.env[`S3_REGION_${alias}`] || process.env[`AWS_REGION_${alias}`] || region;
        putBucket(alias, envVal || undefined, perRegion || undefined);
    }
}

// Expose buckets map
export const buckets: Record<string, BucketEntry> = bucketRegistry;

// Memoize S3 clients per region
const clientsByRegion = new Map<string, S3Client>();
export function getS3(alias = "default"): { client: S3Client; bucket: string; region: string } {
    const entry = buckets[alias.toLowerCase()];
    const selected = entry || (bucket ? { name: bucket, region: region || "" } : undefined);
    if (!selected) {
        throw new Error(`No S3 bucket configured for alias "${alias}"`);
    }
    const reg = selected.region || region || "";
    if (!clientsByRegion.has(reg)) {
        clientsByRegion.set(reg, new S3Client({ region: reg || undefined }));
    }
    return { client: clientsByRegion.get(reg)!, bucket: selected.name, region: reg };
}

// Back-compat single client (uses default region)
export const s3 = new S3Client({ region: region || undefined });

// CloudFront distribution ids
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
