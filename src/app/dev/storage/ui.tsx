"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Anchor, Badge, Box, Button, Container, Flex, Group, LoadingOverlay, Modal, Paper, ScrollArea, Select, Stack, Table, Text, TextInput, Textarea, Title } from "@mantine/core";
import { Dropzone } from "@mantine/dropzone";

type S3Object = { key: string | null | undefined; size: number; lastModified: string | null; eTag: string | null };
type Folder = { prefix?: string | null };

function fmtBytes(n: number) {
  if (!Number.isFinite(n)) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"]; let i = 0; let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export default function DevStorageUI() {
  const [aliases, setAliases] = useState<string[]>([]);
  const [prefixes, setPrefixes] = useState<Record<string, string>>({});
  const [alias, setAlias] = useState<string>("default");
  const [prefix, setPrefix] = useState<string>("");
  const [path, setPath] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [objects, setObjects] = useState<S3Object[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [bucketName, setBucketName] = useState<string>("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorKey, setEditorKey] = useState<string>("");
  const [editorContent, setEditorContent] = useState<string>("");
  const [editorContentType, setEditorContentType] = useState<string>("text/plain; charset=utf-8");
  const [editorSaving, setEditorSaving] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [imageKey, setImageKey] = useState("");
  const [imageSrc, setImageSrc] = useState("");
  const dropRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Load aliases and prefixes
    Promise.all([
      fetch("/api/dev/storage?op=buckets").then((r) => r.json()),
      fetch("/api/dev/storage?op=prefixes").then((r) => r.json()),
    ]).then(([bk, pf]) => {
      setAliases(bk.aliases || []);
      setPrefixes(pf.prefixes || {});
      // Pick default prefix (content if present)
      const p = pf.prefixes?.content || Object.values(pf.prefixes || {})[0] || "";
      const pKey = Object.keys(pf.prefixes || {}).find((k) => pf.prefixes[k] === p) || Object.keys(pf.prefixes || {})[0] || "";
      setPrefix(pKey || "");
    }).catch(() => void 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const effectivePrefixLabel = useMemo(() => (prefix ? prefixes[prefix] || prefix : "(none)"), [prefix, prefixes]);

  async function load(reset = true) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ alias, search });
      if (prefix) params.set("prefix", prefix);
      if (path) params.set("path", path);
      const url = `/api/dev/storage?${params.toString()}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setBucketName(data.bucket || "");
      setFolders(data.folders || []);
      setObjects(data.objects || []);
      setNextToken(data.nextContinuationToken || null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alias, prefix, path, search]);

  async function openEditor(k: string) {
    const params = new URLSearchParams({ alias, key: k });
    const res = await fetch(`/api/dev/storage?${params.toString()}`);
    if (!res.ok) {
      // eslint-disable-next-line no-alert
      alert(`Failed to fetch object: ${await res.text()}`);
      return;
    }
    const data = await res.json();
    if (data.mode === "text") {
      setEditorKey(data.key);
      setEditorContentType(data.contentType);
      setEditorContent(data.text || "");
      setEditorOpen(true);
      return;
    }

    // If it's an image, preview it inline
    if (typeof data.contentType === "string" && data.contentType.startsWith("image/") && data.base64) {
      const src = `data:${data.contentType};base64,${data.base64}`;
      setImageKey(data.key);
      setImageSrc(src);
      setImageOpen(true);
      return;
    }

    // eslint-disable-next-line no-alert
    alert(`Binary or non-text content (type: ${data.contentType}). Download and edit locally.`);
  }

  async function saveEditor() {
    setEditorSaving(true);
    try {
      const res = await fetch("/api/dev/storage", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alias, key: editorKey, content: editorContent, contentType: editorContentType }),
      });
      if (!res.ok) throw new Error(await res.text());
      setEditorOpen(false);
    } catch (e: any) {
      // eslint-disable-next-line no-alert
      alert(`Save failed: ${e?.message || String(e)}`);
    } finally {
      setEditorSaving(false);
    }
  }

  async function deleteKey(k: string) {
    if (!confirm(`Delete object?\n${k}`)) return;
    const params = new URLSearchParams({ alias, key: k });
    const res = await fetch(`/api/dev/storage?${params.toString()}`, { method: "DELETE" });
    if (!res.ok) {
      // eslint-disable-next-line no-alert
      alert(`Delete failed: ${await res.text()}`);
    } else {
      load();
    }
  }

  async function renameKey(k: string) {
    const name = prompt("New key (path/filename)", k);
    if (!name || name === k) return;
    const res = await fetch("/api/dev/storage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "rename", alias, fromKey: k, toKey: name }),
    });
    if (!res.ok) {
      // eslint-disable-next-line no-alert
      alert(`Rename failed: ${await res.text()}`);
    } else {
      load();
    }
  }

  async function handleUpload(files: File[]) {
    if (!files?.length) return;
    const fd = new FormData();
    fd.append("alias", alias);
    if (prefix) fd.append("prefix", prefix);
    if (path) fd.append("path", path);
    for (const f of files) fd.append("file", f, f.name);
    const res = await fetch("/api/dev/storage", { method: "POST", body: fd });
    if (!res.ok) {
      // eslint-disable-next-line no-alert
      alert(`Upload failed: ${await res.text()}`);
    } else {
      load();
    }
  }

  const crumbs = useMemo(() => {
    const parts = (path || "").split("/").filter(Boolean);
    const acc: { label: string; to: string }[] = [];
    let cur = "";
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      acc.push({ label: p, to: cur });
    }
    return acc;
  }, [path]);

  return (
    <Container size="xl" p="md">
      <Title order={3} mb="sm">
        Dev Storage Portal {bucketName ? <Text span c="dimmed">— {bucketName}</Text> : null}
      </Title>
      <Paper withBorder radius="md" p="sm" pos="relative">
        <LoadingOverlay visible={loading} />
        <Stack gap="sm">
          <Group wrap="wrap" gap="sm" align="end">
            <Select
              label="Alias"
              placeholder="Select alias"
              data={aliases.map((a) => ({ value: a, label: a }))}
              value={alias}
              onChange={(v) => setAlias(v || "default")}
              w={180}
            />
            <Select
              label="Prefix"
              placeholder="Prefix"
              data={Object.keys(prefixes).map((k) => ({ value: k, label: `${k} (${prefixes[k]})` }))}
              value={prefix}
              onChange={(v) => setPrefix(v || "")}
              w={240}
            />
            <TextInput label="Path" placeholder="sub/folder" value={path} onChange={(e) => setPath(e.currentTarget.value)} w={240} />
            <TextInput label="Search" placeholder="filter by key" value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={220} />
            <Button onClick={() => load()} variant="light">Refresh</Button>
            <Badge variant="light">Prefix root: {effectivePrefixLabel}</Badge>
          </Group>

          <Dropzone openRef={dropRef} onDrop={handleUpload} radius="md" accept={[]}>
            <Group justify="space-between">
              <Text>Drop files here to upload</Text>
              <Button variant="subtle" onClick={() => dropRef.current?.click?.()}>Choose files</Button>
            </Group>
          </Dropzone>

          <Flex gap="xs" align="center">
            <Text fw={500}>Path:</Text>
            <Anchor c="blue" onClick={() => setPath("")}>root</Anchor>
            {crumbs.map((c, i) => (
              <Group key={c.to} gap={6} align="center">
                <Text>/</Text>
                <Anchor onClick={() => setPath(c.to)}>{c.label}</Anchor>
              </Group>
            ))}
          </Flex>

          <ScrollArea h={480} offsetScrollbars>
            <Table stickyHeader striped withRowBorders withColumnBorders>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Key / Folder</Table.Th>
                  <Table.Th>Size</Table.Th>
                  <Table.Th>Last Modified</Table.Th>
                  <Table.Th>Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {folders.map((f) => {
                  const p = (f.prefix || "").replace(/\/+$/, "");
                  const rel = p.split("/").pop() || p;
                  return (
                    <Table.Tr key={`f:${p}`}>
                      <Table.Td>
                        <Anchor onClick={() => setPath(p)}>{rel}/</Anchor>
                      </Table.Td>
                      <Table.Td>-</Table.Td>
                      <Table.Td>-</Table.Td>
                      <Table.Td>-</Table.Td>
                    </Table.Tr>
                  );
                })}
                {objects.map((o) => (
                  <Table.Tr key={o.key || Math.random()}>
                    <Table.Td>{o.key}</Table.Td>
                    <Table.Td>{fmtBytes(o.size)}</Table.Td>
                    <Table.Td>{o.lastModified ? new Date(o.lastModified).toLocaleString() : ""}</Table.Td>
                    <Table.Td>
                      <Group gap={6}>
                        <Button size="xs" variant="light" onClick={() => o.key && openEditor(o.key)}>View/Edit</Button>
                        <Button size="xs" variant="light" color="gray" onClick={() => o.key && renameKey(o.key)}>Rename</Button>
                        <Button size="xs" variant="light" color="red" onClick={() => o.key && deleteKey(o.key)}>Delete</Button>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Stack>
      </Paper>

      <Modal opened={editorOpen} onClose={() => setEditorOpen(false)} size="xl" title={editorKey} centered>
        <Stack>
          <TextInput label="Content-Type" value={editorContentType} onChange={(e) => setEditorContentType(e.currentTarget.value)} />
          <Textarea label="Content" minRows={12} autosize value={editorContent} onChange={(e) => setEditorContent(e.currentTarget.value)} />
          <Group justify="end">
            <Button onClick={saveEditor} loading={editorSaving}>Save</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={imageOpen} onClose={() => setImageOpen(false)} size="xl" title={imageKey} centered>
        <Box style={{ display: "flex", justifyContent: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageSrc} alt={imageKey} style={{ maxWidth: "100%", maxHeight: 600, objectFit: "contain" }} />
        </Box>
      </Modal>
    </Container>
  );
}
