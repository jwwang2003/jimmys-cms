import { NextRequest } from "next/server";
import {
    DeleteObjectCommand,
    GetObjectCommand,
    ListObjectsV2Command,
    PutObjectCommand,
    CopyObjectCommand,
    HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { buckets, getS3, buildKey, prefixes as knownPrefixes } from "@/lib/s3";

function isDev() {
    return process.env.NODE_ENV !== "production";
}

function devOnlyResponse() {
    return new Response("Forbidden: dev-only endpoint", { status: 403 });
}

async function bodyToBuffer(body: any): Promise<Buffer> {
    if (!body) return Buffer.alloc(0);
    // Web ReadableStream
    if (typeof body.getReader === "function") {
        const reader = body.getReader();
        const parts: Uint8Array[] = [];
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) parts.push(value);
        }
        return Buffer.concat(parts.map((p) => Buffer.from(p)));
    }
    // Async iterator (Node stream in modern Node supports this)
    if (typeof body[Symbol.asyncIterator] === "function") {
        const parts: Buffer[] = [];
        for await (const chunk of body as AsyncIterable<any>) {
            parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        return Buffer.concat(parts);
    }
    // Node readable stream (fallback)
    if (typeof body.on === "function") {
        return await new Promise<Buffer>((resolve, reject) => {
            const parts: Buffer[] = [];
            body.on("data", (c: any) => parts.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
            body.on("end", () => resolve(Buffer.concat(parts)));
            body.on("error", reject);
        });
    }
    // Direct bytes
    if (body instanceof Uint8Array) return Buffer.from(body);
    if (body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(body));
    return Buffer.from(String(body));
}

function parseParams(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const alias = (searchParams.get("alias") || "default").toLowerCase();
    const prefixName = (searchParams.get("prefix") || "").trim();
    const path = (searchParams.get("path") || "").replace(/^\/+|\/+$/g, "");
    const key = (searchParams.get("key") || "").replace(/^\/+/, "");
    const search = (searchParams.get("search") || "").trim();
    const token = searchParams.get("continuationToken") || undefined;
    const maxKeys = Math.max(1, Math.min(1000, Number(searchParams.get("maxKeys") || 500)));
    const op = (searchParams.get("op") || "").toLowerCase();
    const metaKey = (searchParams.get("metaKey") || "").trim();
    const metaValue = (searchParams.get("metaValue") || "").trim();
    const metaMatch = (searchParams.get("metaMatch") || "equals").toLowerCase();
    const headLimit = Math.max(1, Math.min(50, Number(searchParams.get("headLimit") || 10)));
    return { alias, prefixName, path, key, search, token, maxKeys, op, metaKey, metaValue, metaMatch, headLimit };
}

export async function GET(req: NextRequest) {
    if (!isDev()) return devOnlyResponse();

    try {
        const { alias, prefixName, path, key, search, token, maxKeys, op, metaKey, metaValue, metaMatch, headLimit } =
            parseParams(req);

        if (op === "buckets") {
            return Response.json({ aliases: Object.keys(buckets) });
        }
        if (op === "prefixes") {
            return Response.json({ prefixes: knownPrefixes });
        }

        const { client, bucket } = getS3(alias);

        if (key) {
            const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
            const buf = await bodyToBuffer(res.Body as any);
            const contentType = (res.ContentType || "application/octet-stream").toString();
            const size = Number(res.ContentLength || buf.length);

            const isTextLike = /^(text\/|application\/(json|xml|yaml|x-yaml|toml|javascript|typescript))/.test(
                contentType
            );
            if (isTextLike) {
                return Response.json({ key, contentType, size, mode: "text", text: buf.toString("utf8") });
            }
            return Response.json({ key, contentType, size, mode: "base64", base64: buf.toString("base64") });
        }

        const ListPrefix = prefixName ? buildKey(prefixName as keyof typeof knownPrefixes, path) : path || undefined;
        const res = await client.send(
            new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: ListPrefix,
                Delimiter: "/",
                ContinuationToken: token,
                MaxKeys: maxKeys,
            })
        );

        const folders = (res.CommonPrefixes || []).map((p) => ({ prefix: p.Prefix }));
        let objects = (res.Contents || []).map((o) => ({
            key: o.Key,
            size: Number(o.Size || 0),
            lastModified: o.LastModified ? new Date(o.LastModified).toISOString() : null,
            eTag: o.ETag || null,
        }));

        if (search) {
            const q = search.toLowerCase();
            objects = objects.filter((o) => (o.key || "").toLowerCase().includes(q));
        }

        // Optional metadata-based filtering: perform HeadObject on listed keys and match user metadata
        // Note: S3 does not support server-side filtering by metadata during listing. This performs
        // additional requests in parallel (capped by headLimit) and filters client-side.
        let metaFilterApplied = false;
        let headRequests = 0;
        if (metaKey) {
            metaFilterApplied = true;
            const batches: typeof objects[] = [];
            for (let i = 0; i < objects.length; i += headLimit) batches.push(objects.slice(i, i + headLimit));

            const filtered: typeof objects = [];
            for (const batch of batches) {
                const results = await Promise.all(
                    batch.map(async (o) => {
                        if (!o.key) return null;
                        try {
                            headRequests++;
                            const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: o.key }));
                            const md = head.Metadata || {};
                            const v = (md[metaKey.toLowerCase()] ?? md[metaKey] ?? "") as string | undefined;
                            if (metaValue) {
                                const lhs = String(v || "");
                                const rhs = metaValue;
                                const ok =
                                    metaMatch === "equals"
                                        ? lhs === rhs
                                        : metaMatch === "includes"
                                            ? lhs.toLowerCase().includes(rhs.toLowerCase())
                                            : metaMatch === "prefix"
                                                ? lhs.startsWith(rhs)
                                                : metaMatch === "exists"
                                                    ? Boolean(lhs)
                                                    : lhs === rhs;
                                return ok ? o : null;
                            }
                            // If only metaKey present, treat as exists
                            return v ? o : null;
                        } catch {
                            return null; // skip inaccessible objects
                        }
                    })
                );
                for (const r of results) if (r) filtered.push(r);
            }
            objects = filtered;
        }

        return Response.json({
            bucket,
            prefix: ListPrefix || "",
            folders,
            objects,
            isTruncated: Boolean(res.IsTruncated),
            nextContinuationToken: res.NextContinuationToken || null,
            metaFilterApplied,
            headRequests,
        });
    } catch (err: any) {
        return new Response(`Error: ${err?.message || String(err)}`, { status: 500 });
    }
}

export async function PUT(req: NextRequest) {
    if (!isDev()) return devOnlyResponse();
    try {
        const body = await req.json();
        const alias = (body.alias || "default").toLowerCase();
        const key = (body.key || "").replace(/^\/+/, "");
        if (!key) return new Response("Missing key", { status: 400 });
        const { client, bucket } = getS3(alias);
        const contentType = body.contentType || "text/plain; charset=utf-8";
        const content = typeof body.content === "string" ? Buffer.from(body.content, "utf8") : Buffer.alloc(0);

        await client.send(
            new PutObjectCommand({ Bucket: bucket, Key: key, Body: content, ContentType: contentType })
        );
        return Response.json({ ok: true, bucket, key });
    } catch (err: any) {
        return new Response(`Error: ${err?.message || String(err)}`, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    if (!isDev()) return devOnlyResponse();
    try {
        const contentType = req.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
            const body = await req.json();
            const action = (body.action || "").toLowerCase();
            const alias = (body.alias || "default").toLowerCase();
            const { client, bucket } = getS3(alias);

            if (action === "rename") {
                const fromKey = (body.fromKey || "").replace(/^\/+/, "");
                const toKey = (body.toKey || "").replace(/^\/+/, "");
                if (!fromKey || !toKey) return new Response("Missing fromKey/toKey", { status: 400 });
                await client.send(
                    new CopyObjectCommand({
                        Bucket: bucket,
                        CopySource: `${bucket}/${encodeURIComponent(fromKey)}`.replace(/%2F/g, "/"),
                        Key: toKey,
                    })
                );
                await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: fromKey }));
                return Response.json({ ok: true, bucket, fromKey, toKey });
            }

            return new Response("Unknown JSON action", { status: 400 });
        }

        // Multipart form upload
        const form = await req.formData();
        const alias = (form.get("alias") as string | null)?.toLowerCase() || "default";
        const prefixName = (form.get("prefix") as string | null) || "";
        const path = ((form.get("path") as string | null) || "").replace(/^\/+|\/+$/g, "");
        const baseKey = prefixName ? buildKey(prefixName as keyof typeof knownPrefixes, path) : path;
        const { client, bucket } = getS3(alias);

        const files: File[] = [];
        for (const [k, v] of form.entries()) {
            if (v instanceof File) files.push(v);
        }
        if (files.length === 0) return new Response("No files provided", { status: 400 });

        for (const file of files) {
            const arr = new Uint8Array(await file.arrayBuffer());
            const safeBase = (baseKey || "").replace(/\/+$/, "");
            const key = (safeBase ? safeBase + "/" : "") + file.name.replace(/^\/+/, "");
            await client.send(
                new PutObjectCommand({ Bucket: bucket, Key: key, Body: arr, ContentType: file.type || undefined })
            );
        }

        return Response.json({ ok: true, uploaded: files.map((f) => f.name), bucket, baseKey: baseKey || "" });
    } catch (err: any) {
        return new Response(`Error: ${err?.message || String(err)}`, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    if (!isDev()) return devOnlyResponse();
    try {
        const { alias, key } = parseParams(req);
        if (!key) return new Response("Missing key", { status: 400 });
        const { client, bucket } = getS3(alias);
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        return Response.json({ ok: true, bucket, key });
    } catch (err: any) {
        return new Response(`Error: ${err?.message || String(err)}`, { status: 500 });
    }
}
