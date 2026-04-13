"use client";

import { useRef, useState } from "react";
import { Alert, Button, Group, Paper, Stack, Text, TextInput } from "@mantine/core";

export function MediaUploadForm({ editable }: { editable: boolean }) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [path, setPath] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function upload() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("Select a file first.");
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("prefix", file.type.startsWith("image/") ? "content" : "media");
      form.append("path", path);

      const res = await fetch("/api/admin/media", {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Upload failed");
      }
      setMessage(`Uploaded ${file.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Paper
      withBorder
      radius="lg"
      p="md"
      bg="rgba(18, 20, 26, 0.92)"
      style={{ borderColor: "rgba(255, 255, 255, 0.08)" }}
    >
      <Stack gap="sm">
        <Text fw={600}>Upload media</Text>
        {!editable && <Alert color="yellow" variant="light">Guests cannot upload or edit media.</Alert>}
        {error && <Alert color="red" variant="light">{error}</Alert>}
        {message && <Alert color="green" variant="light">{message}</Alert>}
        <TextInput label="Optional sub-path" value={path} onChange={(event) => setPath(event.currentTarget.value)} disabled={!editable} />
        <input ref={fileInputRef} type="file" disabled={!editable} />
        <Group justify="end">
          <Button onClick={upload} loading={loading} disabled={!editable}>Upload</Button>
        </Group>
      </Stack>
    </Paper>
  );
}
