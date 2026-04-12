import type { ClassifiedStorageObject, ManagedMediaType } from "./types";

function cleanSegment(value: string) {
    return value
        .normalize("NFKC")
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-+|-+$/g, "");
}

export function slugFromText(value: string) {
    return cleanSegment(value) || "untitled";
}

function inferTypeFromMime(mimeType: string | null | undefined): ManagedMediaType {
    if (!mimeType) return "other";
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("video/")) return "video";
    return "other";
}

function inferTypeFromKey(key: string) {
    const extension = key.split(".").pop()?.toLowerCase() || "";
    if (["jpg", "jpeg", "png", "gif", "webp", "avif"].includes(extension)) return "image";
    if (["mp4", "mov", "webm", "m4v"].includes(extension)) return "video";
    return "other";
}

function titleFromKey(key: string) {
    const fileName = key.split("/").pop() || key;
    return fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "Untitled asset";
}

export function classifyStorageObject(input: {
    key: string;
    mimeType?: string | null;
    sizeBytes?: number | null;
}) : ClassifiedStorageObject {
    const warnings: string[] = [];
    const mediaType = inferTypeFromMime(input.mimeType) !== "other"
        ? inferTypeFromMime(input.mimeType)
        : inferTypeFromKey(input.key);

    if (mediaType === "other") {
        return {
            outcome: "invalid",
            mediaType: "other",
            warnings: ["unsupported mime type"],
            slug: slugFromText(titleFromKey(input.key)),
            title: titleFromKey(input.key),
        };
    }

    if (!input.sizeBytes || input.sizeBytes <= 0) {
        warnings.push("missing or zero size");
    }

    return {
        outcome: warnings.length > 0 ? "warning" : "valid",
        mediaType,
        warnings,
        slug: slugFromText(titleFromKey(input.key)),
        title: titleFromKey(input.key),
    };
}
