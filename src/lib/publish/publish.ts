import { PutObjectCommand } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { buildState } from "@/db/schema/schema";
import { getS3 } from "@/lib/s3";
import { buildCatalog, buildManifest, type CatalogAsset, type SeriesEntry } from "./catalog";
import { artifactHash, shortHash, GENERATOR_VERSION } from "./content-hash";

export const MANIFEST_KEY = "data/manifest.json";

export type PublishArtifact = {
    artifact: string;
    objectKey: string;
    hash: string;
    sizeBytes: number;
    written: boolean;
    reason: "unchanged" | "new" | "hash-changed" | "forced";
};

export type PublishSummary = {
    generatorVersion: string;
    assets: number;
    artifacts: PublishArtifact[];
    objectsWritten: number;
    changedAssetIds: string[];
};

function readLedger(artifact: string) {
    return db.select().from(buildState).where(eq(buildState.artifact, artifact)).get();
}

function writeLedger(input: {
    artifact: string;
    artifactHash: string;
    objectKey: string;
    objectUrl: string | null;
    sizeBytes: number;
    itemCount: number;
}) {
    db.insert(buildState)
        .values({
            artifact: input.artifact,
            artifactHash: input.artifactHash,
            generatorVersion: GENERATOR_VERSION,
            objectKey: input.objectKey,
            objectUrl: input.objectUrl,
            sizeBytes: input.sizeBytes,
            itemCount: input.itemCount,
            builtAt: new Date(),
        })
        .onConflictDoUpdate({
            target: buildState.artifact,
            set: {
                artifactHash: input.artifactHash,
                generatorVersion: GENERATOR_VERSION,
                objectKey: input.objectKey,
                objectUrl: input.objectUrl,
                sizeBytes: input.sizeBytes,
                itemCount: input.itemCount,
                builtAt: new Date(),
            },
        })
        .run();
}

function artifactUrl(storageId: string, key: string) {
    const { cdnBaseUrl, endpoint, bucket } = getS3(storageId);
    const encoded = key.split("/").map(encodeURIComponent).join("/");
    if (cdnBaseUrl) return `${cdnBaseUrl.replace(/\/+$/, "")}/${encoded}`;
    if (endpoint) return `${endpoint.replace(/\/+$/, "")}/${bucket}/${encoded}`;
    return null;
}

/**
 * Recompute artifacts, diff against the ledger, write only what changed.
 *
 * The correctness property the plan asks for is a pair: a second run with no
 * edits must emit zero objects, and bumping GENERATOR_VERSION must rebuild
 * everything. Either alone can pass with a broken diff, which is why the
 * generator version is mixed into every artifact hash rather than tracked
 * beside it.
 */
export async function publish(input: {
    assets: CatalogAsset[];
    series?: SeriesEntry[];
    storageId?: string;
    dryRun?: boolean;
    force?: boolean;
    generatedAt?: Date;
}): Promise<PublishSummary> {
    const storageId = input.storageId || "media";
    const generatedAt = input.generatedAt || new Date();
    const artifacts: PublishArtifact[] = [];
    let objectsWritten = 0;

    const media = input.dryRun ? null : getS3(storageId);

    const put = async (key: string, body: string, cacheControl: string) => {
        if (!media) return;
        await media.client.send(
            new PutObjectCommand({
                Bucket: media.bucket,
                Key: key,
                Body: Buffer.from(body, "utf8"),
                ContentType: "application/json",
                CacheControl: cacheControl,
            })
        );
        objectsWritten += 1;
    };

    // --- one catalog per medium --------------------------------------------
    // Photography and artwork are separate pages with different shapes, so each
    // gets its own artifact and its own hash. A change to one must not force a
    // re-download of the other.
    const catalogKeys: Record<string, string> = {};
    const counts: Record<string, number> = {};
    const catalogHashes: string[] = [];

    for (const kind of ["photography", "artwork"] as const) {
        const subset = input.assets.filter((asset) => asset.kind === kind);
        const catalog = buildCatalog(subset, kind);
        const hash = artifactHash(subset.map((asset) => asset.contentHash), `${GENERATOR_VERSION}:${kind}`);
        const key = `data/${kind === "artwork" ? "artworks" : "photos"}.${shortHash(hash)}.json`;
        const body = JSON.stringify(catalog);

        catalogKeys[kind] = key;
        counts[kind] = catalog.count;
        catalogHashes.push(hash);

        const artifactName = `catalog:${kind}`;
        const ledger = readLedger(artifactName);
        const changed = !ledger
            ? "new"
            : ledger.artifactHash !== hash
                ? "hash-changed"
                : input.force
                    ? "forced"
                    : "unchanged";

        if (changed !== "unchanged") {
            // Content-hashed key, so the object is immutable and safe to cache
            // for a year: a different catalog is a different key.
            await put(key, body, "public, max-age=31536000, immutable");
            if (!input.dryRun) {
                writeLedger({
                    artifact: artifactName,
                    artifactHash: hash,
                    objectKey: key,
                    objectUrl: artifactUrl(storageId, key),
                    sizeBytes: Buffer.byteLength(body),
                    itemCount: catalog.count,
                });
            }
        }

        artifacts.push({
            artifact: artifactName,
            objectKey: key,
            hash,
            sizeBytes: Buffer.byteLength(body),
            written: changed !== "unchanged",
            reason: changed,
        });
    }

    // --- manifest ----------------------------------------------------------
    // The manifest points at the catalogs, so its hash derives from theirs
    // rather than from its own bytes: it carries a timestamp, and hashing that
    // would make it differ on every run. Series are hashed in too, since the
    // manifest is where they are published.
    const manifest = buildManifest({
        catalogKeys,
        counts,
        series: input.series ?? [],
        generatorVersion: GENERATOR_VERSION,
        generatedAt,
    });
    const manifestHash = artifactHash(
        [...catalogHashes, JSON.stringify(input.series ?? [])],
        `${GENERATOR_VERSION}:manifest`
    );
    const manifestLedger = readLedger("manifest");
    const manifestChanged = !manifestLedger
        ? "new"
        : manifestLedger.artifactHash !== manifestHash
            ? "hash-changed"
            : input.force
                ? "forced"
                : "unchanged";

    if (manifestChanged !== "unchanged") {
        // The only mutable object in the bucket, hence no-cache.
        await put(MANIFEST_KEY, JSON.stringify(manifest), "no-cache");
        if (!input.dryRun) {
            writeLedger({
                artifact: "manifest",
                artifactHash: manifestHash,
                objectKey: MANIFEST_KEY,
                objectUrl: artifactUrl(storageId, MANIFEST_KEY),
                sizeBytes: Buffer.byteLength(JSON.stringify(manifest)),
                itemCount: Object.values(counts).reduce((a, b) => a + b, 0),
            });
        }
    }

    artifacts.push({
        artifact: "manifest",
        objectKey: MANIFEST_KEY,
        hash: manifestHash,
        sizeBytes: Buffer.byteLength(JSON.stringify(manifest)),
        written: manifestChanged !== "unchanged",
        reason: manifestChanged,
    });

    return {
        generatorVersion: GENERATOR_VERSION,
        assets: input.assets.length,
        artifacts,
        objectsWritten,
        changedAssetIds: [],
    };
}

/**
 * Tell the site which ids changed so it can revalidate just those paths.
 *
 * Failure is reported, not thrown: the artifacts are already published and
 * correct at this point, and a missed revalidate is a staleness problem for the
 * site's time-based backstop to absorb, not a reason to fail the publish.
 */
export async function notifyRevalidate(input: {
    endpoint: string;
    secret: string;
    ids: string[];
}): Promise<{ ok: boolean; status?: number; error?: string }> {
    try {
        const response = await fetch(input.endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${input.secret}`,
            },
            body: JSON.stringify({ ids: input.ids }),
        });
        return { ok: response.ok, status: response.status };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}
