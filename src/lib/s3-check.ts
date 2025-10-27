"use server"

import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { getS3, buckets, bucket as defaultBucket, region as defaultRegion } from "@/lib/s3";

let hasRun = false;

export async function verifyS3OnStartup() {
    if (hasRun) return;
    hasRun = true;

    // Determine set of buckets to check; include default if present
    const entries = Object.entries(buckets);
    if (entries.length === 0 && defaultBucket) {
        entries.push(["default", { name: defaultBucket, region: defaultRegion || "" } as any]);
    }

    if (entries.length === 0) {
        const msg = "[startup] S3 check skipped: no buckets configured";
        if (process.env.FAIL_ON_STARTUP_S3 === "1") throw new Error(msg);
        console.warn(msg);
        return;
    }

    for (const [alias, entry] of entries) {
        try {
            const { client, bucket, region } = getS3(alias);
            await client.send(new HeadBucketCommand({ Bucket: bucket }));
            console.log(`[startup] S3 check OK: alias="${alias}" bucket="${bucket}" region="${region}"`);
        } catch (err: any) {
            const msg = `[startup] S3 check FAILED for alias="${alias}" (${err?.name || "Error"}: ${err?.message || err})`;
            if (process.env.FAIL_ON_STARTUP_S3 === "1") {
                // Crash the server so misconfig is obvious in prod
                throw new Error(msg);
            }
            console.error(msg);
        }
    }
}
