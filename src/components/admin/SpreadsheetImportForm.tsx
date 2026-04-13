"use client";

import { useState } from "react";
import { Alert, Button, Group, Paper, Stack, Text } from "@mantine/core";

export function SpreadsheetImportForm({ editable }: { editable: boolean }) {
  const [spreadsheetFile, setSpreadsheetFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!spreadsheetFile) {
      setError("Select a spreadsheet file.");
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const form = new FormData();
      form.append("spreadsheet", spreadsheetFile);
      const res = await fetch("/api/admin/media/metadata-import", {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Spreadsheet import failed");
      }

      const mode = data.googleMapsEnabled
        ? "Google geocoding enabled."
        : "Google key missing, unmatched addresses were stored without geocoding.";
      setMessage(
        `Imported ${data.summary.imported}/${data.summary.rows} rows from ${spreadsheetFile.name}. Unmatched ${data.summary.unmatched}. Tags ${data.summary.updatedTags}. Collections ${data.summary.updatedCollections}. ${mode}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Spreadsheet import failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Paper withBorder radius="lg" p="lg">
      <Stack gap="sm">
        <Text fw={600}>Import spreadsheet metadata</Text>
        <Text size="sm" c="dimmed">
          Upload a V1 `.xlsx`, `.xls`, or `.csv` spreadsheet and merge tags, collections, and location metadata into
          existing assets. Rows that do not match an asset are skipped instead of aborting the batch.
        </Text>
        {!editable && <Alert color="yellow" variant="light">Guests can review import sources but cannot run the import.</Alert>}
        {error && <Alert color="red" variant="light">{error}</Alert>}
        {message && <Alert color="green" variant="light">{message}</Alert>}
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={(event) => setSpreadsheetFile(event.currentTarget.files?.[0] ?? null)}
          disabled={!editable}
        />
        <Group justify="end">
          <Button onClick={submit} loading={loading} disabled={!editable || !spreadsheetFile}>Import spreadsheet</Button>
        </Group>
      </Stack>
    </Paper>
  );
}
