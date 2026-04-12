"use client";

import { useState } from "react";
import { Alert, Button, Group, Paper, Stack, Text, TextInput } from "@mantine/core";

export function SyncRunner({ editable }: { editable: boolean }) {
  const [path, setPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runSync() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/media/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefix: "media", path }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Sync failed");
      }
      setMessage(`Discovered ${data.summary.discovered} objects. Normalized ${data.summary.normalized}, warnings ${data.summary.warning}, invalid ${data.summary.invalid}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Paper withBorder radius="lg" p="lg">
      <Stack gap="sm">
        <Text fw={600}>Sync existing S3 content</Text>
        {!editable && <Alert color="yellow" variant="light">Guests can review sync issues but cannot run sync jobs.</Alert>}
        {error && <Alert color="red" variant="light">{error}</Alert>}
        {message && <Alert color="green" variant="light">{message}</Alert>}
        <TextInput label="Optional sub-path" value={path} onChange={(event) => setPath(event.currentTarget.value)} disabled={!editable} />
        <Group justify="end">
          <Button onClick={runSync} loading={loading} disabled={!editable}>Run sync</Button>
        </Group>
      </Stack>
    </Paper>
  );
}
