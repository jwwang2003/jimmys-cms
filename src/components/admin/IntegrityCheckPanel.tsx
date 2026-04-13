"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Group, Paper, Stack, Text } from "@mantine/core";

export function IntegrityCheckPanel({ editable }: { editable: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function verifyAll() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/media/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verifyMany" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Integrity verification failed");
      }
      setMessage(`Checked ${data.summary.checked}. Missing ${data.summary.missing}. Warning ${data.summary.warning}.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Integrity verification failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Paper withBorder radius="lg" p="lg">
      <Stack gap="sm">
        <Text fw={600}>Integrity checks</Text>
        <Text size="sm" c="dimmed">
          Verify whether catalogued S3 objects still exist. Missing files remain visible as warnings instead of disappearing.
        </Text>
        {!editable && <Alert color="yellow" variant="light">Guests can review integrity state but cannot run verification.</Alert>}
        {error && <Alert color="red" variant="light">{error}</Alert>}
        {message && <Alert color="green" variant="light">{message}</Alert>}
        <Group justify="end">
          <Button onClick={verifyAll} loading={loading} disabled={!editable}>Verify active assets</Button>
        </Group>
      </Stack>
    </Paper>
  );
}
