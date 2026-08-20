import { storageFolders, storageLocations } from "./schema/schema";

type CmsDb = typeof import("./index").db;

type FolderSeed = { type: "images" | "videos" | "gifs" | "misc"; prefix: string; description: string };

const env = (key: string) => (process.env[key] || "").trim();

function upsertLocation(
    db: CmsDb,
    input: { id: string; bucketName: string; region: string; baseUrl: string | null; folders: FolderSeed[] }
) {
    db.insert(storageLocations)
        .values({
            id: input.id,
            bucketName: input.bucketName,
            region: input.region,
            baseUrl: input.baseUrl,
        })
        .onConflictDoUpdate({
            target: storageLocations.id,
            set: {
                bucketName: input.bucketName,
                region: input.region,
                baseUrl: input.baseUrl,
            },
        })
        .run();

    for (const folder of input.folders) {
        db.insert(storageFolders)
            .values({
                storageId: input.id,
                folderType: folder.type,
                prefix: folder.prefix,
                description: folder.description,
            })
            .onConflictDoUpdate({
                target: [storageFolders.storageId, storageFolders.folderType],
                set: {
                    prefix: folder.prefix,
                    description: folder.description,
                },
            })
            .run();
    }
}

function seedStorageDefaults(db: CmsDb) {
    const bucketName = env("S3_BUCKET");
    const region = env("AWS_REGION");
    if (!bucketName) return;

    upsertLocation(db, {
        id: "default",
        bucketName,
        region,
        baseUrl: null,
        folders: [
            { type: "images", prefix: env("CONTENT_PREFIX") || "content/images", description: "images media root" },
            { type: "videos", prefix: env("MEDIA_PREFIX") || "media/videos", description: "videos media root" },
            { type: "gifs", prefix: "media/gifs", description: "gifs media root" },
            { type: "misc", prefix: env("PUBLIC_PREFIX") || "public", description: "misc media root" },
        ],
    });
}

/**
 * Key layout for the two R2 buckets (cms-plan.md §3).
 *
 * `storage_folders` allows one row per (location, folder_type), so each bucket
 * maps its two real prefixes onto the two folder types that fit: the image
 * tree, and everything else.
 */
const R2_FOLDER_LAYOUT: Record<string, FolderSeed[]> = {
    masters: [
        { type: "images", prefix: "masters/originals", description: "master originals — private, never served" },
        { type: "misc", prefix: "masters/orphaned", description: "retained but uncatalogued originals" },
    ],
    media: [
        { type: "images", prefix: "derived/photo", description: "generated renditions — immutable, 1y cache" },
        { type: "misc", prefix: "data", description: "generator artifacts (manifest.json, catalog)" },
    ],
};

/**
 * Register every bucket alias the S3 layer knows about, so `storage_objects`
 * rows have a location to hang off. Aliases are read from the environment
 * rather than imported from `@/lib/s3`, because that module snapshots
 * `process.env` at import time and this runs during database construction.
 */
function seedDeclaredBuckets(db: CmsDb) {
    const seen = new Set<string>();

    for (const [key, value] of Object.entries(process.env)) {
        const match = key.match(/^(?:S3|R2)_BUCKET_([A-Z0-9_]+)$/);
        if (!match || !value?.trim()) continue;

        const rawAlias = match[1];
        const alias = rawAlias.toLowerCase();
        if (seen.has(alias)) continue;
        seen.add(alias);

        const isR2 = key.startsWith("R2_");
        const region = env(`S3_REGION_${rawAlias}`) || env(`AWS_REGION_${rawAlias}`) || (isR2 ? "auto" : env("AWS_REGION"));
        const baseUrl = env(`R2_CDN_BASE_URL_${rawAlias}`) || env(`S3_CDN_BASE_URL_${rawAlias}`) || null;

        upsertLocation(db, {
            id: alias,
            bucketName: value.trim(),
            region,
            baseUrl,
            folders: R2_FOLDER_LAYOUT[alias] ?? [],
        });
    }
}

export function ensureCmsDefaults(db: CmsDb) {
    seedStorageDefaults(db);
    seedDeclaredBuckets(db);
}
