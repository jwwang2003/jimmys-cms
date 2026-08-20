import sharp from "sharp";

/**
 * Derivative generation (cms-plan.md §4).
 *
 * Model: a precomputed responsive set — AVIF and WebP at four widths — rather
 * than one source negotiated at request time. This is a deliberate divergence
 * from `glorialan.com/scripts/optimize-images.mjs`, which emits a single source
 * and lets `next/image` pick format and width, and the plan calls for the two
 * models to be settled rather than left to drift.
 *
 * The precomputed set wins here because the CMS publishes to a static CDN with
 * immutable, content-hashed keys. There is no image server at request time to
 * negotiate with, so the variants have to exist as objects.
 */

/** Widths to emit. A width above the master's own is skipped, never upscaled. */
export const RENDITION_WIDTHS = [400, 800, 1600, 2400] as const;

export const RENDITION_FORMATS = [
    { format: "avif" as const, quality: 78, mimeType: "image/avif" },
    { format: "webp" as const, quality: 82, mimeType: "image/webp" },
];

/**
 * LQIP: a blurred thumbnail inlined as a data URI, shown while the real image
 * loads. 20px wide keeps it a few hundred bytes, which matters because it
 * travels inside the catalog artifact rather than as its own request.
 */
const LQIP_WIDTH = 20;
const LQIP_QUALITY = 50;

export type RenditionSpec = {
    label: string;
    format: "avif" | "webp";
    mimeType: string;
    width: number;
    height: number;
    bytes: Buffer;
};

export type DeriveResult = {
    /** True pixel dimensions, after EXIF orientation is applied. */
    width: number;
    height: number;
    /** What the file claims before rotation, kept so the two can be compared. */
    rawWidth: number;
    rawHeight: number;
    orientation: number | null;
    format: string | null;
    lqip: string;
    renditions: RenditionSpec[];
};

export function renditionLabel(format: string, width: number) {
    return `${format}-${width}`;
}

/**
 * Object key for a rendition. Matches the plan's layout:
 *   derived/photo/<uid>/<w>.<ext>
 */
export function renditionKey(uid: string, width: number, format: string) {
    return `derived/photo/${uid}/${width}.${format}`;
}

/**
 * EXIF orientation values 5-8 rotate by 90 or 270 degrees, which swaps the
 * axes. Reporting the header's width/height for those images gives dimensions
 * transposed from what a browser actually renders, so every layout computed
 * from them is wrong.
 */
function isAxisSwapped(orientation: number | undefined) {
    return typeof orientation === "number" && orientation >= 5 && orientation <= 8;
}

/**
 * Generate every rendition for one master, plus its LQIP and true dimensions,
 * in a single decode pass.
 */
export async function deriveFromMaster(
    master: Buffer | Uint8Array,
    options?: { widths?: readonly number[] }
): Promise<DeriveResult> {
    // failOn "none" so a master with a truncated tail or a malformed EXIF block
    // still yields pixels. These are scans and camera originals, not generated
    // files, and refusing the whole image over a bad marker loses the work.
    const image = sharp(Buffer.from(master), { failOn: "none" });
    const meta = await image.metadata();

    const rawWidth = meta.width ?? 0;
    const rawHeight = meta.height ?? 0;
    if (!rawWidth || !rawHeight) {
        throw new Error("could not read image dimensions");
    }

    const swapped = isAxisSwapped(meta.orientation);
    const width = swapped ? rawHeight : rawWidth;
    const height = swapped ? rawWidth : rawHeight;

    const lqipBuffer = await sharp(Buffer.from(master), { failOn: "none" })
        .rotate()
        .resize({ width: LQIP_WIDTH, fit: "inside" })
        .webp({ quality: LQIP_QUALITY })
        .toBuffer();
    const lqip = `data:image/webp;base64,${lqipBuffer.toString("base64")}`;

    const widths = (options?.widths ?? RENDITION_WIDTHS).filter((w) => w <= width);
    // A master narrower than the smallest configured width would otherwise
    // produce no renditions at all. Emit it at its own size instead.
    if (widths.length === 0) widths.push(width);

    const renditions: RenditionSpec[] = [];
    for (const targetWidth of widths) {
        for (const spec of RENDITION_FORMATS) {
            // `.rotate()` with no argument bakes in the EXIF orientation, so the
            // output needs no orientation tag to display correctly.
            const pipeline = sharp(Buffer.from(master), { failOn: "none" })
                .rotate()
                .resize({ width: targetWidth, fit: "inside", withoutEnlargement: true });

            const encoded =
                spec.format === "avif"
                    ? pipeline.avif({ quality: spec.quality })
                    : pipeline.webp({ quality: spec.quality });

            const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
            renditions.push({
                label: renditionLabel(spec.format, targetWidth),
                format: spec.format,
                mimeType: spec.mimeType,
                width: info.width,
                height: info.height,
                bytes: data,
            });
        }
    }

    return {
        width,
        height,
        rawWidth,
        rawHeight,
        orientation: meta.orientation ?? null,
        format: meta.format ?? null,
        lqip,
        renditions,
    };
}
