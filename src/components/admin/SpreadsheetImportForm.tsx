"use client";

import { useState } from "react";
import { Alert, Button, Group, Paper, Select, Stack, Text } from "@mantine/core";

export function SpreadsheetImportForm({
  editable,
  files,
}: {
  editable: boolean;
  files: string[];
}) {
  const [fileName, setFileName] = useState<string | null>(files[0] || null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!fileName) return;

    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/media/metadata-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Spreadsheet import failed");
      }

      const mode = data.googleMapsEnabled
        ? "Google geocoding enabled."
        : "Google key missing, unmatched addresses were stored without geocoding.";
      setMessage(
        `Imported ${data.summary.imported}/${data.summary.rows} rows from ${fileName}. Unmatched ${data.summary.unmatched}. Tags ${data.summary.updatedTags}. Collections ${data.summary.updatedCollections}. ${mode}`
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
          Loads `.xlsx` or `.csv` files from the local `data/` folder and merges tags, collections, and location metadata into
          existing assets. Rows that do not match an asset are skipped instead of aborting the batch.
        </Text>
        {!editable && <Alert color="yellow" variant="light">Guests can review import sources but cannot run the import.</Alert>}
        {files.length === 0 && <Alert color="yellow" variant="light">No spreadsheet files were found in the `data/` folder.</Alert>}
        {error && <Alert color="red" variant="light">{error}</Alert>}
        {message && <Alert color="green" variant="light">{message}</Alert>}
        <Select
          label="Spreadsheet file"
          data={files}
          value={fileName}
          onChange={setFileName}
          disabled={!editable || files.length === 0}
          searchable
        />
        <Group justify="end">
          <Button onClick={submit} loading={loading} disabled={!editable || !fileName}>Import spreadsheet</Button>
        </Group>
      </Stack>
    </Paper>
  );
}
