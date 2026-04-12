"use client";

import { useState } from "react";
import { Alert, Button, Group, Paper, Select, Stack, Text, TextInput, Textarea } from "@mantine/core";

type AssetDetail = {
  id: number;
  title: string;
  description: string | null;
  status: string;
  visibility: string;
  tags: string[];
  collections: { title: string }[];
  locations: Array<{
    raw_address?: string | null;
    formatted_address?: string | null;
    lat?: number | null;
    lng?: number | null;
  }>;
  warnings: string[];
};

export function AssetEditor({ asset, editable }: { asset: AssetDetail; editable: boolean }) {
  const [title, setTitle] = useState(asset.title);
  const [description, setDescription] = useState(asset.description || "");
  const [status, setStatus] = useState(asset.status);
  const [visibility, setVisibility] = useState(asset.visibility);
  const [tagSlugs, setTagSlugs] = useState(asset.tags.join(", "));
  const [collectionNames, setCollectionNames] = useState(asset.collections.map((collection) => collection.title).join(", "));
  const [rawAddress, setRawAddress] = useState(asset.locations[0]?.raw_address || "");
  const [formattedAddress, setFormattedAddress] = useState(asset.locations[0]?.formatted_address || "");
  const [lat, setLat] = useState(asset.locations[0]?.lat?.toString() || "");
  const [lng, setLng] = useState(asset.locations[0]?.lng?.toString() || "");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/media/${asset.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          status,
          visibility,
          tagSlugs,
          collectionNames,
          rawAddress,
          formattedAddress,
          lat,
          lng,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to save asset");
      }
      setMessage("Asset saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save asset");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Paper withBorder radius="lg" p="lg">
      <Stack gap="md">
        {!editable && (
          <Alert color="yellow" variant="light">
            Guest sessions are read-only.
          </Alert>
        )}
        {asset.warnings.length > 0 && (
          <Alert color="yellow" variant="light">
            {asset.warnings.join(", ")}
          </Alert>
        )}
        {error && <Alert color="red" variant="light">{error}</Alert>}
        {message && <Alert color="green" variant="light">{message}</Alert>}

        <TextInput label="Title" value={title} onChange={(event) => setTitle(event.currentTarget.value)} disabled={!editable} />
        <Textarea label="Description" value={description} onChange={(event) => setDescription(event.currentTarget.value)} disabled={!editable} />
        <Group grow>
          <Select
            label="Status"
            value={status}
            onChange={(value) => setStatus(value || "draft")}
            disabled={!editable}
            data={[
              { value: "draft", label: "Draft" },
              { value: "review", label: "Review" },
              { value: "published", label: "Published" },
              { value: "archived", label: "Archived" },
            ]}
          />
          <Select
            label="Visibility"
            value={visibility}
            onChange={(value) => setVisibility(value || "private")}
            disabled={!editable}
            data={[
              { value: "private", label: "Private" },
              { value: "internal", label: "Internal" },
              { value: "public", label: "Public" },
            ]}
          />
        </Group>

        <TextInput label="Tags" value={tagSlugs} onChange={(event) => setTagSlugs(event.currentTarget.value)} disabled={!editable} />
        <TextInput
          label="Collections"
          description="Comma-separated collection names"
          value={collectionNames}
          onChange={(event) => setCollectionNames(event.currentTarget.value)}
          disabled={!editable}
        />

        <Text size="sm" fw={600}>Primary location</Text>
        <TextInput label="Raw address" value={rawAddress} onChange={(event) => setRawAddress(event.currentTarget.value)} disabled={!editable} />
        <TextInput
          label="Formatted address"
          value={formattedAddress}
          onChange={(event) => setFormattedAddress(event.currentTarget.value)}
          disabled={!editable}
        />
        <Group grow>
          <TextInput label="Latitude" value={lat} onChange={(event) => setLat(event.currentTarget.value)} disabled={!editable} />
          <TextInput label="Longitude" value={lng} onChange={(event) => setLng(event.currentTarget.value)} disabled={!editable} />
        </Group>

        <Group justify="end">
          <Button onClick={save} loading={saving} disabled={!editable}>Save asset</Button>
        </Group>
      </Stack>
    </Paper>
  );
}
