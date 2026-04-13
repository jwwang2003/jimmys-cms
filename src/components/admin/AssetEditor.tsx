"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Group, Paper, Pill, PillGroup, Select, Stack, Text, TextInput, Textarea } from "@mantine/core";

import { GeocodeRefreshPanel } from "./GeocodeRefreshPanel";

type AssetDetail = {
  id: number;
  title: string;
  description: string | null;
  media_type: string;
  object_url: string | null;
  object_key: string;
  status: string;
  visibility: string;
  integrity_status: string;
  integrity_message?: string | null;
  tags: string[];
  collections: { title: string }[];
  locations: Array<{
    raw_address?: string | null;
    formatted_address?: string | null;
    lat?: number | null;
    lng?: number | null;
    source?: string | null;
    status?: string | null;
  }>;
  warnings: string[];
  filename?: string | null;
};

export function AssetEditor({ asset, editable }: { asset: AssetDetail; editable: boolean }) {
  const router = useRouter();
  const [title, setTitle] = useState(asset.title);
  const [description, setDescription] = useState(asset.description || "");
  const [status, setStatus] = useState(asset.status);
  const [visibility, setVisibility] = useState(asset.visibility);
  const [tagSlugs, setTagSlugs] = useState(asset.tags);
  const [tagDraft, setTagDraft] = useState("");
  const [collectionNames, setCollectionNames] = useState(asset.collections.map((collection) => collection.title).join(", "));
  const [filename, setFilename] = useState(asset.filename || "");
  const [rawAddress, setRawAddress] = useState(asset.locations[0]?.raw_address || "");
  const [formattedAddress, setFormattedAddress] = useState(asset.locations[0]?.formatted_address || "");
  const [lat, setLat] = useState(asset.locations[0]?.lat?.toString() || "");
  const [lng, setLng] = useState(asset.locations[0]?.lng?.toString() || "");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function addTag(value: string) {
    const normalized = value.trim();
    if (!normalized) return;
    setTagSlugs((current) =>
      current.some((tag) => tag.toLowerCase() === normalized.toLowerCase()) ? current : [...current, normalized]
    );
    setTagDraft("");
  }

  function removeTag(tagToRemove: string) {
    setTagSlugs((current) => current.filter((tag) => tag !== tagToRemove));
  }

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
          filename,
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
    <Paper
      withBorder
      radius="lg"
      p="md"
      bg="rgba(18, 20, 26, 0.92)"
      style={{ borderColor: "rgba(255, 255, 255, 0.08)" }}
    >
      <Stack gap="sm">
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
        <TextInput
          label="Filename"
          value={filename}
          onChange={(event) => setFilename(event.currentTarget.value)}
          disabled={!editable}
        />
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

        <Stack gap={6}>
          <Text size="xs" fw={700} tt="uppercase" c="dimmed">
            Tags
          </Text>
          <PillGroup>
            {tagSlugs.map((tag) => (
              <Pill
                key={tag}
                withRemoveButton={editable}
                onRemove={() => removeTag(tag)}
                removeButtonProps={{ "aria-label": `Remove tag ${tag}` }}
              >
                {tag}
              </Pill>
            ))}
          </PillGroup>
          <Group align="end">
            <TextInput
              label="Add tag"
              placeholder="portrait, travel, archive..."
              value={tagDraft}
              onChange={(event) => setTagDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addTag(tagDraft);
                }
              }}
              disabled={!editable}
              style={{ flex: 1 }}
            />
            <Button variant="default" onClick={() => addTag(tagDraft)} disabled={!editable || !tagDraft.trim()}>
              Add tag
            </Button>
          </Group>
        </Stack>
        <TextInput
          label="Collections"
          description="Comma-separated collection names"
          value={collectionNames}
          onChange={(event) => setCollectionNames(event.currentTarget.value)}
          disabled={!editable}
        />

        <Text size="xs" fw={700} tt="uppercase" c="dimmed">Primary location</Text>
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

        <GeocodeRefreshPanel
          editable={editable}
          scope="asset"
          assetId={asset.id}
          locations={asset.locations}
          onAssetRefreshed={(nextAsset) => {
            const primary = nextAsset.locations?.[0];
            setRawAddress(primary?.raw_address || "");
            setFormattedAddress(primary?.formatted_address || "");
            setLat(primary?.lat != null ? String(primary.lat) : "");
            setLng(primary?.lng != null ? String(primary.lng) : "");
            router.refresh();
          }}
        />
      </Stack>
    </Paper>
  );
}
