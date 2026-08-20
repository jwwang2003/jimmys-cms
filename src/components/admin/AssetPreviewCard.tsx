import { Alert, Anchor, AspectRatio, Image, Paper, Pill, PillGroup, Stack, Text } from "@mantine/core";

export function AssetPreviewCard({
  asset,
}: {
  asset: {
    title: string;
    media_type: string;
    object_url?: string | null;
    thumbnail_url?: string | null;
    object_key: string;
    filename?: string | null;
    tags?: string[];
    integrity_status?: string | null;
  };
}) {
  const missing = asset.integrity_status === "missing";
  // The master is private, so only the derived rendition is actually loadable
  // in a browser. object_url stays as the "open original" link, which is a
  // different thing from an inline preview.
  const previewSrc = asset.thumbnail_url || asset.object_url;

  return (
    <Paper
      withBorder
      radius="lg"
      p="md"
      bg="rgba(18, 20, 26, 0.92)"
      style={{ borderColor: "rgba(255, 255, 255, 0.08)" }}
    >
      <Stack gap="sm">
        <div>
          <Text fw={600}>Preview</Text>
          {asset.filename && <Text size="sm">{asset.filename}</Text>}
          <Text size="sm" c="dimmed">{asset.object_key}</Text>
        </div>

        {asset.tags && asset.tags.length > 0 && (
          <PillGroup>
            {asset.tags.map((tag) => (
              <Pill key={tag}>{tag}</Pill>
            ))}
          </PillGroup>
        )}

        {missing && (
          <Alert color="yellow" variant="light">
            This asset is currently marked missing by integrity checks. Preview may be unavailable.
          </Alert>
        )}

        {previewSrc && asset.media_type === "image" && (
          <AspectRatio ratio={4 / 3}>
            <Image src={previewSrc} alt={asset.title} fit="contain" radius="md" />
          </AspectRatio>
        )}

        {asset.object_url && asset.media_type === "video" && (
          <AspectRatio ratio={16 / 9}>
            <video
              controls
              preload="metadata"
              src={asset.object_url}
              style={{ width: "100%", height: "100%", borderRadius: "0.5rem", background: "#111" }}
            />
          </AspectRatio>
        )}

        {(!asset.object_url || (asset.media_type !== "image" && asset.media_type !== "video")) && (
          <Alert color="gray" variant="light">
            Preview unavailable. No browser preview available for this asset yet.
          </Alert>
        )}

        {asset.object_url && (
          <Anchor href={asset.object_url} target="_blank" rel="noreferrer">
            Open original file
          </Anchor>
        )}
      </Stack>
    </Paper>
  );
}
