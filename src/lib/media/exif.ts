import type { PhotoExifInput } from "./types";

const JPG_SOI = 0xffd8;
const MARKER_APP1 = 0xe1;
const MARKER_SOS = 0xda;
const MARKER_EOI = 0xd9;

const TYPE_SIZES: Record<number, number> = {
    1: 1,
    2: 1,
    3: 2,
    4: 4,
    5: 8,
    7: 1,
    9: 4,
    10: 8,
};

type ReaderFns = {
    readUint16: (offset: number) => number;
    readUint32: (offset: number) => number;
    readInt32: (offset: number) => number;
};

type ExifEntry = {
    tag: number;
    type: number;
    count: number;
    dataOffset: number;
};

export function extractPhotoExif(bytes: Uint8Array): PhotoExifInput | null {
    if (bytes.length < 4) {
        return null;
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint16(0, false) !== JPG_SOI) {
        return null;
    }

    let offset = 2;
    while (offset + 3 < bytes.length) {
        if (bytes[offset] !== 0xff) {
            offset += 1;
            continue;
        }

        const marker = bytes[offset + 1];
        offset += 2;

        if (marker === 0x00) continue;
        if (marker === MARKER_EOI || marker === MARKER_SOS) break;
        if (marker >= 0xd0 && marker <= 0xd7) continue;
        if (offset + 2 > bytes.length) break;

        const segmentLength = view.getUint16(offset, false);
        if (segmentLength < 2) {
            throw new Error("Invalid JPEG segment length");
        }

        const segmentStart = offset + 2;
        const segmentEnd = offset + segmentLength;
        if (segmentEnd > bytes.length) {
            throw new Error("JPEG segment exceeds bounds");
        }

        if (marker === MARKER_APP1 && hasExifHeader(view, segmentStart)) {
            return parseExifSegment(view, segmentStart, segmentEnd);
        }

        offset = segmentEnd;
    }

    return null;
}

function parseExifSegment(view: DataView, segmentStart: number, segmentEnd: number): PhotoExifInput {
    if (!hasExifHeader(view, segmentStart)) {
        throw new Error("Invalid EXIF header");
    }

    const tiffStart = segmentStart + 6;
    if (tiffStart + 8 > segmentEnd) {
        throw new Error("EXIF segment too short");
    }

    const byteOrder = readAscii(view, tiffStart, 2);
    const littleEndian = byteOrder === "II";
    if (!littleEndian && byteOrder !== "MM") {
        throw new Error("Unsupported TIFF byte order");
    }

    const reader: ReaderFns = {
        readUint16: (offset) => view.getUint16(offset, littleEndian),
        readUint32: (offset) => view.getUint32(offset, littleEndian),
        readInt32: (offset) => view.getInt32(offset, littleEndian),
    };

    const magic = reader.readUint16(tiffStart + 2);
    if (magic !== 42) {
        throw new Error("Invalid TIFF header");
    }

    const result: PhotoExifInput = {
        camera: {},
        lens: {},
        metadata: {},
    };

    let exifPointer = 0;
    let gpsPointer = 0;

    const firstIfdOffset = reader.readUint32(tiffStart + 4);
    if (!firstIfdOffset) {
        return result;
    }

    parseIfd(view, tiffStart, tiffStart + firstIfdOffset, reader, (entry) => {
        switch (entry.tag) {
            case 0x010f:
                result.camera = { ...(result.camera || {}), make: readAscii(view, entry.dataOffset, entry.count) || null };
                break;
            case 0x0110:
                result.camera = { ...(result.camera || {}), model: readAscii(view, entry.dataOffset, entry.count) || null };
                break;
            case 0x0112:
                result.orientation = readShortOrLong(view, entry, reader);
                break;
            case 0x0131:
                result.software = readAscii(view, entry.dataOffset, entry.count) || null;
                break;
            case 0x8769:
                exifPointer = readShortOrLong(view, entry, reader) || 0;
                break;
            case 0x8825:
                gpsPointer = readShortOrLong(view, entry, reader) || 0;
                break;
            default:
                break;
        }
    });

    if (exifPointer) {
        parseIfd(view, tiffStart, tiffStart + exifPointer, reader, (entry) => {
            switch (entry.tag) {
                case 0x9003:
                    result.captureDate = normalizeExifDate(readAscii(view, entry.dataOffset, entry.count));
                    break;
                case 0xa434:
                    result.lens = { ...(result.lens || {}), model: readAscii(view, entry.dataOffset, entry.count) || null };
                    break;
                case 0x920a:
                    result.focalLength = readFirstRational(view, entry.dataOffset, reader);
                    break;
                case 0x829d:
                    result.aperture = readFirstRational(view, entry.dataOffset, reader);
                    break;
                case 0x829a:
                    result.exposureTime = readRationalText(view, entry.dataOffset, reader);
                    break;
                case 0x8827:
                    result.iso = readShortOrLong(view, entry, reader);
                    break;
                case 0xa002:
                    result.pixelWidth = readShortOrLong(view, entry, reader);
                    break;
                case 0xa003:
                    result.pixelHeight = readShortOrLong(view, entry, reader);
                    break;
                default:
                    break;
            }
        });
    }

    if (gpsPointer) {
        const gpsState: {
            latRef: string | null;
            lngRef: string | null;
            lat: number | null;
            lng: number | null;
            altitude: number | null;
            altitudeRef: number;
        } = {
            latRef: null,
            lngRef: null,
            lat: null,
            lng: null,
            altitude: null,
            altitudeRef: 0,
        };

        parseIfd(view, tiffStart, tiffStart + gpsPointer, reader, (entry) => {
            switch (entry.tag) {
                case 0x0001:
                    gpsState.latRef = readAscii(view, entry.dataOffset, entry.count) || null;
                    break;
                case 0x0002:
                    gpsState.lat = readGpsCoordinate(view, entry.dataOffset, reader);
                    break;
                case 0x0003:
                    gpsState.lngRef = readAscii(view, entry.dataOffset, entry.count) || null;
                    break;
                case 0x0004:
                    gpsState.lng = readGpsCoordinate(view, entry.dataOffset, reader);
                    break;
                case 0x0005:
                    gpsState.altitudeRef = view.getUint8(entry.dataOffset);
                    break;
                case 0x0006:
                    gpsState.altitude = readFirstRational(view, entry.dataOffset, reader);
                    break;
                default:
                    break;
            }
        });

        if (gpsState.lat !== null && gpsState.lng !== null) {
            const latRefText =
                typeof gpsState.latRef === "string" ? gpsState.latRef.toUpperCase() : "";
            const lngRefText =
                typeof gpsState.lngRef === "string" ? gpsState.lngRef.toUpperCase() : "";
            result.location = {
                lat: latRefText === "S" ? -gpsState.lat : gpsState.lat,
                lng: lngRefText === "W" ? -gpsState.lng : gpsState.lng,
                altitude:
                    gpsState.altitude === null
                        ? null
                        : gpsState.altitudeRef === 1
                            ? -gpsState.altitude
                            : gpsState.altitude,
            };
        }
    }

    result.metadata = {
        captureDate: result.captureDate || null,
        cameraMake: result.camera?.make || null,
        cameraModel: result.camera?.model || null,
        lensModel: result.lens?.model || null,
        focalLength: result.focalLength ?? null,
        aperture: result.aperture ?? null,
        exposureTime: result.exposureTime || null,
        iso: result.iso ?? null,
        orientation: result.orientation ?? null,
        software: result.software || null,
        pixelWidth: result.pixelWidth ?? null,
        pixelHeight: result.pixelHeight ?? null,
        location: result.location || null,
    };

    return result;
}

function parseIfd(
    view: DataView,
    tiffStart: number,
    offset: number,
    reader: ReaderFns,
    handler: (entry: ExifEntry) => void
) {
    const entryCount = reader.readUint16(offset);
    const entriesBase = offset + 2;

    for (let index = 0; index < entryCount; index += 1) {
        const entryOffset = entriesBase + index * 12;
        const tag = reader.readUint16(entryOffset);
        const type = reader.readUint16(entryOffset + 2);
        const count = reader.readUint32(entryOffset + 4);
        const valueBytes = (TYPE_SIZES[type] || 1) * count;
        const dataOffset = valueBytes > 4 ? tiffStart + reader.readUint32(entryOffset + 8) : entryOffset + 8;
        handler({ tag, type, count, dataOffset });
    }
}

function hasExifHeader(view: DataView, offset: number) {
    if (offset + 6 > view.byteLength) return false;
    return (
        view.getUint8(offset) === 0x45 &&
        view.getUint8(offset + 1) === 0x78 &&
        view.getUint8(offset + 2) === 0x69 &&
        view.getUint8(offset + 3) === 0x66 &&
        view.getUint8(offset + 4) === 0x00 &&
        view.getUint8(offset + 5) === 0x00
    );
}

function readAscii(view: DataView, offset: number, count: number) {
    const chars: number[] = [];
    for (let index = 0; index < count; index += 1) {
        const value = view.getUint8(offset + index);
        if (value === 0) break;
        chars.push(value);
    }
    return String.fromCharCode(...chars);
}

function readShortOrLong(view: DataView, entry: ExifEntry, reader: ReaderFns) {
    if (entry.type === 3) {
        return reader.readUint16(entry.dataOffset);
    }
    return reader.readUint32(entry.dataOffset);
}

function readFirstRational(view: DataView, offset: number, reader: ReaderFns) {
    const numerator = reader.readUint32(offset);
    const denominator = reader.readUint32(offset + 4);
    if (!denominator) return null;
    return numerator / denominator;
}

function readRationalText(view: DataView, offset: number, reader: ReaderFns) {
    const numerator = reader.readUint32(offset);
    const denominator = reader.readUint32(offset + 4);
    if (!denominator) return null;
    if (numerator === 0) return "0";
    return denominator === 1 ? String(numerator) : `${numerator}/${denominator}`;
}

function readGpsCoordinate(view: DataView, offset: number, reader: ReaderFns) {
    const degrees = readFirstRational(view, offset, reader);
    const minutes = readFirstRational(view, offset + 8, reader);
    const seconds = readFirstRational(view, offset + 16, reader);
    if (degrees === null || minutes === null || seconds === null) return null;
    return degrees + minutes / 60 + seconds / 3600;
}

function normalizeExifDate(raw: string) {
    const match = raw.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
    if (!match) return null;
    const [, year, month, day, hour, minute, second] = match;
    return `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
}
