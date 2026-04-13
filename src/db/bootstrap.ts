import { storageFolders, storageLocations } from "./schema/schema";

type CmsDb = typeof import("./index").db;

function seedStorageDefaults(db: CmsDb) {
    const bucketName = process.env.S3_BUCKET || "";
    const region = process.env.AWS_REGION || "";
    if (!bucketName) return;

    db.insert(storageLocations)
        .values({
            id: "default",
            bucketName,
            region,
            baseUrl: null,
        })
        .onConflictDoUpdate({
            target: storageLocations.id,
            set: {
                bucketName,
                region,
            },
        })
        .run();

    const folders = [
        { type: "images" as const, prefix: process.env.CONTENT_PREFIX || "content/images" },
        { type: "videos" as const, prefix: process.env.MEDIA_PREFIX || "media/videos" },
        { type: "gifs" as const, prefix: "media/gifs" },
        { type: "misc" as const, prefix: process.env.PUBLIC_PREFIX || "public" },
    ];

    for (const folder of folders) {
        db.insert(storageFolders)
            .values({
                storageId: "default",
                folderType: folder.type,
                prefix: folder.prefix,
                description: `${folder.type} media root`,
            })
            .onConflictDoUpdate({
                target: [storageFolders.storageId, storageFolders.folderType],
                set: {
                    prefix: folder.prefix,
                },
            })
            .run();
    }
}

export function ensureCmsDefaults(db: CmsDb) {
    seedStorageDefaults(db);
}
