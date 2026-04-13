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
    filename?: string | null;
    description?: string | null;
    visibility?: "private" | "internal" | "public";
    status?: "draft" | "review" | "published" | "archived";
    tagSlugs?: string[];
    collectionNames?: string[];
    locations?: AssetLocationInput[];
};

export type PhotoExifCamera = {
    make?: string | null;
    model?: string | null;
};

export type PhotoExifLens = {
    model?: string | null;
};

export type PhotoExifLocation = {
    lat: number;
    lng: number;
    altitude?: number | null;
};

export type PhotoExifInput = {
    captureDate?: string | null;
    pixelWidth?: number | null;
    pixelHeight?: number | null;
    camera?: PhotoExifCamera | null;
    lens?: PhotoExifLens | null;
    location?: PhotoExifLocation | null;
    focalLength?: number | null;
    aperture?: number | null;
    iso?: number | null;
    exposureTime?: string | null;
    orientation?: number | null;
    software?: string | null;
    metadata?: Record<string, unknown> | null;
};

export type LocationConflictResolution = "keep_exif" | "keep_existing";

export type LocationConflictRecord = {
    id: number;
    assetId: number;
    assetTitle: string;
    distanceMeters: number | null;
    existingLocation: {
        id: number | null;
        label?: string | null;
        source?: string | null;
        lat?: number | null;
        lng?: number | null;
    };
    candidateLocation: {
        id: number | null;
        source?: string | null;
        lat?: number | null;
        lng?: number | null;
        createdAt?: number | null;
    };
    status: "pending" | "resolved";
    resolution: LocationConflictResolution | null;
    resolvedBy: string | null;
    createdAt: number;
    resolvedAt: number | null;
};
