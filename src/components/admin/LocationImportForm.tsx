"use client";

import { useState } from "react";
import { Alert, Button, Group, Paper, Stack, Text, Textarea } from "@mantine/core";

export function LocationImportForm({ editable }: { editable: boolean }) {
  const [csv, setCsv] = useState("asset_id,address\n");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/media/location-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Location import failed");
      }
      const mode = data.googleMapsEnabled ? "Google geocoding enabled" : "Google key missing, imported rows stored as pending";
      setMessage(
        `Imported ${data.summary.imported}/${data.summary.rows} rows. Unmatched ${data.summary.unmatched}. Geocoded ${data.summary.geocoded}. ${mode}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Location import failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Paper withBorder radius="lg" p="lg">
      <Stack gap="sm">
        <Text fw={600}>Import locations</Text>
        <Text size="sm" c="dimmed">
          Paste CSV exported from your Excel pipeline. Supported columns include `asset_id`, `object_key`, `address`, `label`,
          `formatted_address`, `lat`, and `lng`.
        </Text>
        {!editable && <Alert color="yellow" variant="light">Guests can review imported locations but cannot import new rows.</Alert>}
        {error && <Alert color="red" variant="light">{error}</Alert>}
        {message && <Alert color="green" variant="light">{message}</Alert>}
        <Textarea minRows={8} autosize value={csv} onChange={(event) => setCsv(event.currentTarget.value)} disabled={!editable} />
        <Group justify="end">
          <Button onClick={submit} loading={loading} disabled={!editable}>Import CSV</Button>
        </Group>
      </Stack>
    </Paper>
  );
}
