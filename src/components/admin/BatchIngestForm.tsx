"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Group, Paper, Progress, Stack, Text } from "@mantine/core";

type BatchIngestSnapshot = {
  job: {
    id: number;
    status: string;
    total_items: number;
    processed_items: number;
    completed_items: number;
    warning_items: number;
    failed_items: number;
    unmatched_rows: number;
    current_item_label?: string | null;
    summary_json?: string | null;
    error_message?: string | null;
  };
  items: Array<{
    id: number;
    order_index: number;
    original_filename: string;
    status: string;
    progress_percent: number;
    warning_message?: string | null;
    error_message?: string | null;
    stored_object_key?: string | null;
  }>;
};

function isTerminalStatus(status: string | null | undefined) {
  return status === "completed" || status === "failed" || status === "canceled";
}

export function BatchIngestForm({ editable }: { editable: boolean }) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const [spreadsheetFile, setSpreadsheetFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<BatchIngestSnapshot | null>(null);

  useEffect(() => {
    if (!jobId) return;

    let cancelled = false;
    const applyPayload = (payload: unknown) => {
      const next = payload as { snapshot?: BatchIngestSnapshot } | BatchIngestSnapshot;
      const resolved = "snapshot" in (next as { snapshot?: BatchIngestSnapshot }) ? (next as { snapshot?: BatchIngestSnapshot }).snapshot : next as BatchIngestSnapshot;
      if (!cancelled && resolved?.job) {
        setSnapshot(resolved);
      }
    };

    const loadSnapshot = async () => {
      const response = await fetch(`/api/admin/media/batch-import/${jobId}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load batch ingest status");
      }
      applyPayload(payload.snapshot);
    };

    loadSnapshot().catch((value) => {
      if (!cancelled) {
        setError(value instanceof Error ? value.message : "Failed to load batch ingest status");
      }
    });

    const source = new EventSource(`/api/admin/media/batch-import/${jobId}/events`);
    eventSourceRef.current = source;

    const onSnapshot = (event: MessageEvent<string>) => {
      applyPayload(JSON.parse(event.data));
    };
    const onComplete = (event: MessageEvent<string>) => {
      applyPayload(JSON.parse(event.data));
      source.close();
    };
    const onErrorEvent = () => {
      loadSnapshot().catch(() => undefined);
    };

    source.addEventListener("snapshot", onSnapshot as EventListener);
    source.addEventListener("job", onSnapshot as EventListener);
    source.addEventListener("complete", onComplete as EventListener);
    source.addEventListener("error", onErrorEvent);

    return () => {
      cancelled = true;
      source.close();
      if (eventSourceRef.current === source) {
        eventSourceRef.current = null;
      }
    };
  }, [jobId]);

  async function submit() {
    const selectedFiles = Array.from(fileInputRef.current?.files || []);
    if (!spreadsheetFile) {
      setError("Select a spreadsheet file.");
      return;
    }
    if (selectedFiles.length === 0) {
      setError("Select one or more images or videos.");
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);
    setSnapshot(null);
    try {
      const form = new FormData();
      form.append("spreadsheet", spreadsheetFile);
      selectedFiles.forEach((file) => form.append("files", file));

      const res = await fetch("/api/admin/media/batch-import", {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Batch ingest failed");
      }

      const mode = data.googleMapsEnabled
        ? "Google geocoding enabled."
        : "Google key missing, matched rows were stored without geocoding.";
      setMessage(`Batch ingest job ${data.jobId} started. ${mode}`);
      setJobId(Number(data.jobId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Batch ingest failed");
    } finally {
      setLoading(false);
    }
  }

  const overallProgress =
    snapshot && snapshot.job.total_items > 0
      ? Math.round((snapshot.job.processed_items / snapshot.job.total_items) * 100)
      : 0;

  return (
    <Paper withBorder radius="lg" p="lg">
      <Stack gap="sm">
        <Text fw={600}>Batch ingest media + spreadsheet</Text>
        <Text size="sm" c="dimmed">
          Upload a V1 spreadsheet and a batch of images or videos, then match each file by filename pattern{" "}
          <code>{`<id>+<name>+YYYYMMDD.ext`}</code>. This is the <code>simple-cms</code> style batch workflow.
        </Text>
        {!editable && <Alert color="yellow" variant="light">Guests can review the ingest setup but cannot run imports.</Alert>}
        {error && <Alert color="red" variant="light">{error}</Alert>}
        {message && <Alert color="green" variant="light">{message}</Alert>}
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={(event) => setSpreadsheetFile(event.currentTarget.files?.[0] ?? null)}
          disabled={!editable}
        />
        <input ref={fileInputRef} type="file" multiple accept="image/*,video/*" disabled={!editable} />
        <Group justify="end">
          <Button onClick={submit} loading={loading} disabled={!editable || !spreadsheetFile}>Run batch ingest</Button>
        </Group>

        {snapshot && (
          <Paper withBorder radius="md" p="md">
            <Stack gap="sm">
              <div>
                <Text fw={600}>Overall progress</Text>
                <Text size="sm" c="dimmed">
                  {snapshot.job.processed_items}/{snapshot.job.total_items} processed
                </Text>
              </div>
              <Progress value={overallProgress} />
              <Group gap="xs">
                <Badge color="blue">Completed {snapshot.job.completed_items}</Badge>
                <Badge color="yellow">Warnings {snapshot.job.warning_items}</Badge>
                <Badge color="red">Failed {snapshot.job.failed_items}</Badge>
                <Badge color="gray">Unmatched rows {snapshot.job.unmatched_rows}</Badge>
              </Group>
              <Text size="sm">Current status: {snapshot.job.status}</Text>
              <Text size="sm" c="dimmed">
                Current item: {snapshot.job.current_item_label || "Idle"}
              </Text>
              {snapshot.job.error_message && (
                <Alert color="red" variant="light">{snapshot.job.error_message}</Alert>
              )}
              {isTerminalStatus(snapshot.job.status) && snapshot.job.summary_json && (
                <Alert color="green" variant="light">{snapshot.job.summary_json}</Alert>
              )}
              <Stack gap="xs">
                {snapshot.items.map((item) => (
                  <Paper key={item.id} withBorder radius="md" p="sm">
                    <Stack gap={4}>
                      <Group justify="space-between">
                        <Text size="sm" fw={500}>{item.original_filename}</Text>
                        <Badge variant="light">{item.status}</Badge>
                      </Group>
                      <Progress value={item.progress_percent} size="sm" />
                      {item.stored_object_key && (
                        <Text size="xs" c="dimmed">{item.stored_object_key}</Text>
                      )}
                      {item.warning_message && (
                        <Text size="xs" c="yellow">{item.warning_message}</Text>
                      )}
                      {item.error_message && (
                        <Text size="xs" c="red">{item.error_message}</Text>
                      )}
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            </Stack>
          </Paper>
        )}
      </Stack>
    </Paper>
  );
}
