import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "../../db";
import { mediaIngestJobItems, mediaIngestJobs } from "../../db/schema/schema";
import { resolveCreatedByUserId } from "./repository";
import { uploadMediaAsset } from "./service";
import { batchIngestMediaIntoDb } from "./spreadsheet-import";
import { parseBatchFilename } from "./filename";
import { parseMetadataSpreadsheet } from "./spreadsheet";

type UploadFile = {
    fileName: string;
    bytes: Uint8Array;
    mimeType?: string | null;
};

function now() {
    return new Date();
}

function normalizeExternalId(value: string | null | undefined) {
    const normalized = String(value || "").trim().toLocaleLowerCase();
    if (!normalized) return "";
    if (/^\d+$/.test(normalized)) {
        return normalized.replace(/^0+(\d+)$/, "$1") || "0";
    }
    return normalized;
}

function mediaTypeForUpload(fileName: string, mimeType?: string | null) {
    if (mimeType?.startsWith("image/")) return "image";
    if (mimeType?.startsWith("video/")) return "video";
    const extension = fileName.split(".").pop()?.toLowerCase();
    if (["jpg", "jpeg", "png", "gif", "webp", "avif"].includes(extension || "")) return "image";
    if (["mp4", "mov", "webm", "m4v"].includes(extension || "")) return "video";
    return "other";
}

function buildRowsByExternalId(spreadsheet: { fileName: string; bytes: Buffer | Uint8Array }) {
    const parsed = parseMetadataSpreadsheet(spreadsheet);
    const rowsByExternalId = new Map<string, (typeof parsed.rows)[number]>();
    for (const row of parsed.rows) {
        if (!row.externalId) continue;
        rowsByExternalId.set(normalizeExternalId(row.externalId), row);
    }
    return { parsed, rowsByExternalId };
}

function isTerminalJobStatus(status: string) {
    return status === "completed" || status === "failed" || status === "canceled";
}

function recalculateBatchIngestJob(jobId: number, overrides?: { unmatchedRows?: number; currentItemLabel?: string | null }) {
    const items = db
        .select({
            status: mediaIngestJobItems.status,
        })
        .from(mediaIngestJobItems)
        .where(eq(mediaIngestJobItems.jobId, jobId))
        .all();

    const completedItems = items.filter((item) => item.status === "completed").length;
    const warningItems = items.filter((item) => item.status === "warning").length;
    const failedItems = items.filter((item) => item.status === "failed").length;
    const processedItems = completedItems + warningItems + failedItems;

    db.update(mediaIngestJobs)
        .set({
            processedItems,
            completedItems,
            warningItems,
            failedItems,
            unmatchedRows: overrides?.unmatchedRows ?? sql`${mediaIngestJobs.unmatchedRows}`,
            currentItemLabel:
                overrides && Object.prototype.hasOwnProperty.call(overrides, "currentItemLabel")
                    ? overrides.currentItemLabel || null
                    : sql`${mediaIngestJobs.currentItemLabel}`,
            updatedAt: now(),
        })
        .where(eq(mediaIngestJobs.id, jobId))
        .run();
}

export function createBatchIngestJob(input: {
    spreadsheetFileName: string;
    createdBy?: string | null;
    files: Array<{ fileName: string; mimeType?: string | null }>;
    /** Job kind. Free text on the row, so a new mode needs no migration. */
    mode?: string;
}) {
    const timestamp = now();
    const createdBy = resolveCreatedByUserId(input.createdBy);
    const created = db
        .insert(mediaIngestJobs)
        .values({
            status: "queued",
            mode: input.mode || "batch_upload",
            spreadsheetFilename: input.spreadsheetFileName,
            totalItems: input.files.length,
            processedItems: 0,
            completedItems: 0,
            warningItems: 0,
            failedItems: 0,
            unmatchedRows: 0,
            currentItemLabel: null,
            summaryJson: null,
            errorMessage: null,
            createdBy,
            startedAt: null,
            finishedAt: null,
            createdAt: timestamp,
            updatedAt: timestamp,
        })
        .returning({ id: mediaIngestJobs.id })
        .get();

    input.files.forEach((file, index) => {
        db.insert(mediaIngestJobItems)
            .values({
                jobId: Number(created.id),
                orderIndex: index,
                originalFilename: file.fileName,
                storedObjectKey: null,
                externalId: null,
                detectedMediaType: mediaTypeForUpload(file.fileName, file.mimeType),
                status: "queued",
                progressPercent: 0,
                assetId: null,
                warningMessage: null,
                errorMessage: null,
                detailJson: null,
                createdAt: timestamp,
                updatedAt: timestamp,
            })
            .run();
    });

    return { id: Number(created.id) };
}

export function updateBatchIngestJobItem(
    jobId: number,
    orderIndex: number,
    patch: {
        status?: "queued" | "parsing" | "matching" | "uploading" | "uploaded" | "metadata_applied" | "warning" | "failed" | "completed";
        progressPercent?: number;
        assetId?: number | null;
        storedObjectKey?: string | null;
        externalId?: string | null;
        detectedMediaType?: string | null;
        warningMessage?: string | null;
        errorMessage?: string | null;
        detail?: Record<string, unknown> | null;
    }
) {
    db.update(mediaIngestJobItems)
        .set({
            status: patch.status ?? sql`${mediaIngestJobItems.status}`,
            progressPercent: patch.progressPercent ?? sql`${mediaIngestJobItems.progressPercent}`,
            assetId:
                patch.assetId !== undefined ? patch.assetId : sql`${mediaIngestJobItems.assetId}`,
            storedObjectKey:
                patch.storedObjectKey !== undefined
                    ? patch.storedObjectKey
                    : sql`${mediaIngestJobItems.storedObjectKey}`,
            externalId:
                patch.externalId !== undefined ? patch.externalId : sql`${mediaIngestJobItems.externalId}`,
            detectedMediaType:
                patch.detectedMediaType !== undefined
                    ? patch.detectedMediaType
                    : sql`${mediaIngestJobItems.detectedMediaType}`,
            warningMessage:
                patch.warningMessage !== undefined
                    ? patch.warningMessage
                    : sql`${mediaIngestJobItems.warningMessage}`,
            errorMessage:
                patch.errorMessage !== undefined
                    ? patch.errorMessage
                    : sql`${mediaIngestJobItems.errorMessage}`,
            detailJson:
                patch.detail !== undefined
                    ? patch.detail
                        ? JSON.stringify(patch.detail)
                        : null
                    : sql`${mediaIngestJobItems.detailJson}`,
            updatedAt: now(),
        })
        .where(and(eq(mediaIngestJobItems.jobId, jobId), eq(mediaIngestJobItems.orderIndex, orderIndex)))
        .run();

    recalculateBatchIngestJob(jobId);
}

export function finalizeBatchIngestJob(
    jobId: number,
    input: {
        status: "completed" | "failed" | "canceled";
        summary?: Record<string, unknown>;
        errorMessage?: string | null;
        unmatchedRows?: number;
    }
) {
    recalculateBatchIngestJob(jobId, { unmatchedRows: input.unmatchedRows });
    db.update(mediaIngestJobs)
        .set({
            status: input.status,
            summaryJson: input.summary ? JSON.stringify(input.summary) : null,
            errorMessage: input.errorMessage || null,
            finishedAt: now(),
            updatedAt: now(),
            currentItemLabel: null,
            unmatchedRows:
                input.unmatchedRows !== undefined ? input.unmatchedRows : sql`${mediaIngestJobs.unmatchedRows}`,
        })
        .where(eq(mediaIngestJobs.id, jobId))
        .run();
}

export function getBatchIngestJobSnapshot(jobId: number) {
    const job = db
        .select({
            id: mediaIngestJobs.id,
            status: mediaIngestJobs.status,
            mode: mediaIngestJobs.mode,
            spreadsheet_filename: mediaIngestJobs.spreadsheetFilename,
            total_items: mediaIngestJobs.totalItems,
            processed_items: mediaIngestJobs.processedItems,
            completed_items: mediaIngestJobs.completedItems,
            warning_items: mediaIngestJobs.warningItems,
            failed_items: mediaIngestJobs.failedItems,
            unmatched_rows: mediaIngestJobs.unmatchedRows,
            current_item_label: mediaIngestJobs.currentItemLabel,
            summary_json: mediaIngestJobs.summaryJson,
            error_message: mediaIngestJobs.errorMessage,
            created_by: mediaIngestJobs.createdBy,
            started_at: mediaIngestJobs.startedAt,
            finished_at: mediaIngestJobs.finishedAt,
            created_at: mediaIngestJobs.createdAt,
            updated_at: mediaIngestJobs.updatedAt,
        })
        .from(mediaIngestJobs)
        .where(eq(mediaIngestJobs.id, jobId))
        .limit(1)
        .get();
    if (!job) {
        throw new Error("Batch ingest job not found");
    }

    const items = db
        .select({
            id: mediaIngestJobItems.id,
            job_id: mediaIngestJobItems.jobId,
            order_index: mediaIngestJobItems.orderIndex,
            original_filename: mediaIngestJobItems.originalFilename,
            stored_object_key: mediaIngestJobItems.storedObjectKey,
            external_id: mediaIngestJobItems.externalId,
            detected_media_type: mediaIngestJobItems.detectedMediaType,
            status: mediaIngestJobItems.status,
            progress_percent: mediaIngestJobItems.progressPercent,
            asset_id: mediaIngestJobItems.assetId,
            warning_message: mediaIngestJobItems.warningMessage,
            error_message: mediaIngestJobItems.errorMessage,
            detail_json: mediaIngestJobItems.detailJson,
            created_at: mediaIngestJobItems.createdAt,
            updated_at: mediaIngestJobItems.updatedAt,
        })
        .from(mediaIngestJobItems)
        .where(eq(mediaIngestJobItems.jobId, jobId))
        .orderBy(asc(mediaIngestJobItems.orderIndex), asc(mediaIngestJobItems.id))
        .all();

    return { job, items };
}

async function runBatchIngestJob(input: {
    jobId: number;
    spreadsheet: { fileName: string; bytes: Buffer | Uint8Array };
    files: UploadFile[];
    createdBy?: string | null;
}) {
    const timestamp = now();
    db.update(mediaIngestJobs)
        .set({
            status: "running",
            startedAt: timestamp,
            updatedAt: timestamp,
        })
        .where(eq(mediaIngestJobs.id, input.jobId))
        .run();

    const { rowsByExternalId } = buildRowsByExternalId(input.spreadsheet);
    const aggregate = {
        files: input.files.length,
        imported: 0,
        unmatchedRows: rowsByExternalId.size,
        unmatchedFiles: 0,
        invalidFiles: 0,
        geocoded: 0,
        pending: 0,
        failed: 0,
        updatedTags: 0,
        updatedCollections: 0,
    };

    for (let index = 0; index < input.files.length; index += 1) {
        const file = input.files[index];
        const mediaType = mediaTypeForUpload(file.fileName, file.mimeType);
        let lastAsset = null as Awaited<ReturnType<typeof uploadMediaAsset>> | null;

        updateBatchIngestJobItem(input.jobId, index, {
            status: "parsing",
            progressPercent: 10,
            detectedMediaType: mediaType,
            warningMessage: null,
            errorMessage: null,
        });
        recalculateBatchIngestJob(input.jobId, { currentItemLabel: file.fileName });

        let parsedFileName;
        try {
            parsedFileName = parseBatchFilename(file.fileName);
        } catch (error) {
            aggregate.invalidFiles += 1;
            updateBatchIngestJobItem(input.jobId, index, {
                status: "failed",
                progressPercent: 100,
                errorMessage: error instanceof Error ? error.message : "Invalid filename format",
            });
            continue;
        }

        const externalId = normalizeExternalId(parsedFileName.id);
        updateBatchIngestJobItem(input.jobId, index, {
            status: "matching",
            progressPercent: 25,
            externalId,
        });

        if (!rowsByExternalId.has(externalId)) {
            aggregate.unmatchedFiles += 1;
            updateBatchIngestJobItem(input.jobId, index, {
                status: "failed",
                progressPercent: 100,
                errorMessage: `No spreadsheet row matched external id ${parsedFileName.id}`,
            });
            continue;
        }

        try {
            updateBatchIngestJobItem(input.jobId, index, {
                status: "uploading",
                progressPercent: 50,
            });

            const summary = await batchIngestMediaIntoDb(db, {
                spreadsheet: input.spreadsheet,
                mediaFiles: [file],
                persistFile: async (persistInput) => {
                    lastAsset = await uploadMediaAsset({
                        storageId: "default",
                        prefix: persistInput.mimeType?.startsWith("image/") ? "content" : "media",
                        fileName: persistInput.fileName,
                        bytes: persistInput.bytes,
                        mimeType: persistInput.mimeType || null,
                        createdBy: input.createdBy,
                    });
                    updateBatchIngestJobItem(input.jobId, index, {
                        status: "uploaded",
                        progressPercent: 75,
                        storedObjectKey: lastAsset?.object_key || null,
                        assetId: lastAsset?.id || null,
                    });

                    if (!lastAsset?.id || !lastAsset.media_type || (lastAsset.media_type !== "image" && lastAsset.media_type !== "video")) {
                        throw new Error(`Failed to persist supported media asset for ${persistInput.fileName}`);
                    }

                    return {
                        assetId: Number(lastAsset.id),
                        mediaType: lastAsset.media_type,
                    };
                },
            });

            aggregate.imported += summary.imported;
            aggregate.unmatchedFiles += summary.unmatchedFiles;
            aggregate.invalidFiles += summary.invalidFiles;
            aggregate.geocoded += summary.geocoded;
            aggregate.pending += summary.pending;
            aggregate.failed += summary.failed;
            aggregate.updatedTags += summary.updatedTags;
            aggregate.updatedCollections += summary.updatedCollections;

            if (summary.imported > 0) {
                rowsByExternalId.delete(externalId);
                const warningMessage =
                    summary.pending > 0
                        ? "Imported with pending geocoding."
                        : summary.failed > 0
                            ? "Imported with metadata warnings."
                            : null;
                updateBatchIngestJobItem(input.jobId, index, {
                    status: warningMessage ? "warning" : "completed",
                    progressPercent: 100,
                    storedObjectKey: lastAsset?.object_key || null,
                    assetId: lastAsset?.id || null,
                    warningMessage,
                });
            } else {
                updateBatchIngestJobItem(input.jobId, index, {
                    status: "failed",
                    progressPercent: 100,
                    errorMessage: "Batch ingest did not import this file",
                });
            }
        } catch (error) {
            aggregate.failed += 1;
            updateBatchIngestJobItem(input.jobId, index, {
                status: "failed",
                progressPercent: 100,
                errorMessage: error instanceof Error ? error.message : "Batch ingest failed",
            });
        }
    }

    aggregate.unmatchedRows = rowsByExternalId.size;
    finalizeBatchIngestJob(input.jobId, {
        status: "completed",
        unmatchedRows: aggregate.unmatchedRows,
        summary: aggregate,
    });
}

export async function createAndRunBatchIngestJob(input: {
    spreadsheet: { fileName: string; bytes: Buffer | Uint8Array };
    files: UploadFile[];
    createdBy?: string | null;
}) {
    const job = createBatchIngestJob({
        spreadsheetFileName: input.spreadsheet.fileName,
        createdBy: input.createdBy,
        files: input.files.map((file) => ({
            fileName: file.fileName,
            mimeType: file.mimeType,
        })),
    });

    void runBatchIngestJob({
        jobId: job.id,
        spreadsheet: input.spreadsheet,
        files: input.files,
        createdBy: input.createdBy,
    }).catch((error) => {
        finalizeBatchIngestJob(job.id, {
            status: "failed",
            errorMessage: error instanceof Error ? error.message : "Batch ingest job failed",
        });
    });

    return job;
}

export function readBatchIngestJob(jobId: number) {
    return getBatchIngestJobSnapshot(jobId);
}

export function isBatchIngestJobTerminal(jobId: number) {
    const snapshot = getBatchIngestJobSnapshot(jobId);
    return isTerminalJobStatus(snapshot.job.status);
}

// ------------------------------------------------------------- derive jobs

/**
 * Derivative generation as a tracked job (plan §4).
 *
 * Reuses the batch-ingest machinery rather than growing a parallel one: the
 * item table, the progress recalculation and the SSE stream already model
 * "long-running, per-item, resumable-looking work", which is exactly what a
 * derive run is. Only the per-item body differs.
 */
export function createDeriveJob(input: {
    targets: Array<{ assetId: number; objectKey: string; uid: string }>;
    createdBy?: string | null;
}) {
    return createBatchIngestJob({
        mode: "derive",
        spreadsheetFileName: `derive:${input.targets.length} asset(s)`,
        createdBy: input.createdBy,
        files: input.targets.map((target) => ({
            fileName: target.objectKey.split("/").pop() || target.objectKey,
            mimeType: null,
        })),
    });
}

async function runDeriveJob(input: {
    jobId: number;
    targets: Array<{
        assetId: number;
        objectKey: string;
        uid: string;
        declaredWidth?: number | null;
        declaredHeight?: number | null;
    }>;
    applyDimensions?: boolean;
    measureOnly?: boolean;
}) {
    const timestamp = now();
    db.update(mediaIngestJobs)
        .set({ status: "running", startedAt: timestamp, updatedAt: timestamp })
        .where(eq(mediaIngestJobs.id, input.jobId))
        .run();

    // Imported here rather than at module scope: derive-run pulls in sharp,
    // which is a heavy native dependency that the batch-upload path never needs.
    const { runDerive } = await import("./derive-run");

    const summary = await runDerive({
        targets: input.targets,
        applyDimensions: input.applyDimensions,
        measureOnly: input.measureOnly,
        onProgress: (done, _total, target) => {
            const index = done - 1;
            updateBatchIngestJobItem(input.jobId, index, {
                status: "uploading",
                progressPercent: 10,
                assetId: target.assetId,
                storedObjectKey: target.objectKey,
            });
        },
    });

    summary.outcomes.forEach((outcome, index) => {
        if (outcome.error) {
            updateBatchIngestJobItem(input.jobId, index, {
                status: "failed",
                progressPercent: 100,
                errorMessage: outcome.error,
            });
            return;
        }
        updateBatchIngestJobItem(input.jobId, index, {
            // A skipped dimension write is a warning, not a failure: the
            // renditions were still produced, and the conflict wants a human.
            status: outcome.skipped ? "warning" : "completed",
            progressPercent: 100,
            assetId: outcome.assetId,
            warningMessage: outcome.skipped || null,
            detail: {
                renditions: outcome.renditions,
                uploaded: outcome.uploaded,
                measured: outcome.measured,
            },
        });
    });

    finalizeBatchIngestJob(input.jobId, {
        status: summary.failed > 0 && summary.processed === 0 ? "failed" : "completed",
        summary: {
            processed: summary.processed,
            failed: summary.failed,
            renditionsWritten: summary.renditionsWritten,
            objectsUploaded: summary.objectsUploaded,
            dimensionsApplied: summary.dimensionsApplied,
            dimensionDiffs: summary.dimensionDiffs,
        },
    });

    return summary;
}

export async function createAndRunDeriveJob(input: {
    targets: Array<{
        assetId: number;
        objectKey: string;
        uid: string;
        declaredWidth?: number | null;
        declaredHeight?: number | null;
    }>;
    applyDimensions?: boolean;
    measureOnly?: boolean;
    createdBy?: string | null;
}) {
    const job = createDeriveJob({ targets: input.targets, createdBy: input.createdBy });

    void runDeriveJob({
        jobId: job.id,
        targets: input.targets,
        applyDimensions: input.applyDimensions,
        measureOnly: input.measureOnly,
    }).catch((error) => {
        finalizeBatchIngestJob(job.id, {
            status: "failed",
            errorMessage: error instanceof Error ? error.message : "Derive job failed",
        });
    });

    return job;
}
