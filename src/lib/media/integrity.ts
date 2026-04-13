import { HeadObjectCommand } from "@aws-sdk/client-s3";

import { getS3 } from "@/lib/s3";

import type { AssetIntegrityStatus } from "./types";

export function classifyIntegrityResult(input: {
    ok: boolean;
    code?: string;
    message?: string;
}): {
    integrityStatus: AssetIntegrityStatus;
    integrityMessage: string | null;
} {
    if (input.ok) {
        return {
            integrityStatus: "ok",
            integrityMessage: null,
        };
    }

    if (
        input.code === "NotFound" ||
        input.code === "NoSuchKey" ||
        input.code === "NotFoundError"
    ) {
        return {
            integrityStatus: "missing",
            integrityMessage: input.message || "Object not found in S3",
        };
    }

    return {
        integrityStatus: "warning",
        integrityMessage: input.message || "AWS error while verifying object",
    };
}

export async function verifyS3ObjectIntegrity(input: { storageId: string; objectKey: string }) {
    if (!input.storageId || !input.objectKey) {
        return {
            integrityStatus: "invalid" as const,
            integrityMessage: "Missing storage mapping",
        };
    }

    try {
        const { client, bucket } = getS3(input.storageId);
        await client.send(
            new HeadObjectCommand({
                Bucket: bucket,
                Key: input.objectKey,
            })
        );

        return {
            integrityStatus: "ok" as const,
            integrityMessage: null,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : "AWS error while verifying object";
        const code = typeof error === "object" && error && "name" in error ? String(error.name) : "Error";
        return classifyIntegrityResult({
            ok: false,
            code,
            message,
        });
    }
}
