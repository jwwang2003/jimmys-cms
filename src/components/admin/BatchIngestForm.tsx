"use client";

import { useRef, useState } from "react";
import { Alert, Button, Group, Paper, Select, Stack, Text } from "@mantine/core";

export function BatchIngestForm({
  editable,
  files,
}: {
  editable: boolean;
  files: string[];
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [spreadsheetFileName, setSpreadsheetFileName] = useState<string | null>(files[0] || null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const selectedFiles = Array.from(fileInputRef.current?.files || []);
    if (!spreadsheetFileName) {
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
    try {
      const form = new FormData();
      form.append("spreadsheetFileName", spreadsheetFileName);
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
      setMessage(
        `Imported ${data.summary.imported}/${data.summary.files} files with ${data.summary.unmatchedRows} unmatched spreadsheet rows. Invalid files ${data.summary.invalidFiles}. ${mode}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Batch ingest failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Paper withBorder radius="lg" p="lg">
      <Stack gap="sm">
        <Text fw={600}>Batch ingest media + spreadsheet</Text>
        <Text size="sm" c="dimmed">
          Upload a batch of images or videos, then match each file to the selected spreadsheet by filename pattern{" "}
          <code>{`<id>+<name>+YYYYMMDD.ext`}</code>. This is the <code>simple-cms</code> style batch workflow.
        </Text>
        {!editable && <Alert color="yellow" variant="light">Guests can review the ingest setup but cannot run imports.</Alert>}
        {files.length === 0 && <Alert color="yellow" variant="light">No spreadsheet files were found in the `data/` folder.</Alert>}
        {error && <Alert color="red" variant="light">{error}</Alert>}
        {message && <Alert color="green" variant="light">{message}</Alert>}
        <Select
          label="Spreadsheet file"
          data={files}
          value={spreadsheetFileName}
          onChange={setSpreadsheetFileName}
          disabled={!editable || files.length === 0}
          searchable
        />
        <input ref={fileInputRef} type="file" multiple accept="image/*,video/*" disabled={!editable} />
        <Group justify="end">
          <Button onClick={submit} loading={loading} disabled={!editable || !spreadsheetFileName}>Run batch ingest</Button>
        </Group>
      </Stack>
    </Paper>
  );
}
