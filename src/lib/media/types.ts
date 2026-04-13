export type MediaOutcome = "valid" | "warning" | "invalid";
export type ManagedMediaType = "image" | "video" | "other";
export type AssetLifecycleStatus = "active" | "trashed";
export type AssetIntegrityStatus = "ok" | "missing" | "warning" | "invalid";

export type ClassifiedStorageObject = {
    outcome: MediaOutcome;
    mediaType: ManagedMediaType;
    warnings: string[];
    slug: string;
    title: string;
};

export type AssetLocationInput = {
    label?: string;
    rawAddress?: string;
    formattedAddress?: string;
    googlePlaceId?: string;
    lat?: number | null;
    lng?: number | null;
    isPrimary?: boolean;
    source?: string;
    sourceRef?: string;
    status?: "pending" | "matched" | "geocoded" | "failed";
    rawResponseJson?: string;
};

export type AssetUpdateInput = {
    title?: string;
    description?: string | null;
    visibility?: "private" | "internal" | "public";
    status?: "draft" | "review" | "published" | "archived";
    tagSlugs?: string[];
    collectionNames?: string[];
    locations?: AssetLocationInput[];
};
