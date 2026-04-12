type TableInfoRow = {
    name: string;
};

type SqliteLike = {
    exec(sql: string): unknown;
    prepare(sql: string): {
        run(...args: unknown[]): unknown;
        get(...args: unknown[]): unknown;
    };
};

function hasTable(db: SqliteLike, tableName: string) {
    const row = db
        .prepare("select name from sqlite_master where type = 'table' and name = ?")
        .get(tableName) as TableInfoRow | undefined;
    return row?.name === tableName;
}

function seedStorageDefaults(db: SqliteLike) {
    if (!hasTable(db, "storage_locations")) return;

    const bucketName = process.env.S3_BUCKET || "";
    const region = process.env.AWS_REGION || "";
    if (!bucketName) return;

    db.prepare(`
        INSERT INTO storage_locations (id, bucket_name, region, base_url)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET bucket_name = excluded.bucket_name, region = excluded.region
    `).run("default", bucketName, region, null);

    if (!hasTable(db, "storage_folders")) return;

    const folders = [
        { type: "images", prefix: process.env.CONTENT_PREFIX || "content/images" },
        { type: "videos", prefix: process.env.MEDIA_PREFIX || "media/videos" },
        { type: "gifs", prefix: "media/gifs" },
        { type: "misc", prefix: process.env.PUBLIC_PREFIX || "public" },
    ];

    for (const folder of folders) {
        db.prepare(`
            INSERT INTO storage_folders (storage_id, folder_type, prefix, description)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(storage_id, folder_type) DO UPDATE SET prefix = excluded.prefix
        `).run("default", folder.type, folder.prefix, `${folder.type} media root`);
    }
}

export function ensureCmsDefaults(db: SqliteLike) {
    seedStorageDefaults(db);
}
