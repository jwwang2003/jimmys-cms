"use client";

import Link from "next/link";
import { AspectRatio, Badge, Box, Group, Image, Paper, Pill, PillGroup, Stack, Text } from "@mantine/core";

import { AssetActionMenu } from "./AssetActionMenu";

type AssetRow = {
  id: number;
  title: string;
  slug: string;
  filename?: string | null;
  media_type: string;
  object_url?: string | null;
  thumbnail_url?: string | null;
  object_key: string;
  status: string;
  visibility: string;
  lifecycle_status: string;
  integrity_status: string;
  tags: string[];
  warnings: string[];
};

function integrityColor(status: string) {
  if (status === "missing") return "red";
  if (status === "warning" || status === "invalid") return "yellow";
  return "green";
}

function AssetThumb({ asset }: { asset: AssetRow }) {
  // Prefer the derived thumbnail. The master sits in a private bucket the
  // browser has no credentials for, so object_url renders as a broken image —
  // and it is tens of MB where the rendition is a few KB.
  const previewSrc = asset.thumbnail_url || asset.object_url;

  if (previewSrc && asset.media_type === "image") {
    return (
      <AspectRatio ratio={1} w={84}>
        <Image src={previewSrc} alt={asset.title} radius="md" fit="cover" />
      </AspectRatio>
    );
  }

  if (asset.object_url && asset.media_type === "video") {
    return (
      <AspectRatio ratio={1} w={84}>
        <video
          muted
          preload="metadata"
          src={asset.object_url}
          style={{ width: "100%", height: "100%", borderRadius: "0.75rem", objectFit: "cover" }}
        />
      </AspectRatio>
    );
  }

  return (
    <AspectRatio ratio={1} w={84}>
      <Box
        style={{
          borderRadius: "0.75rem",
          background: "linear-gradient(180deg, rgba(67, 72, 84, 0.45), rgba(22, 24, 31, 0.95))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "1px solid rgba(255, 255, 255, 0.08)",
        }}
      >
        <Text size="xs" c="dimmed" tt="uppercase">
          {asset.media_type}
        </Text>
      </Box>
    </AspectRatio>
  );
}

export function AssetTable({ assets, editable }: { assets: AssetRow[]; editable: boolean }) {
  if (assets.length === 0) {
    return (
      <Paper
        withBorder
        radius="lg"
        p="xl"
        bg="rgba(18, 20, 26, 0.92)"
        style={{ borderColor: "rgba(255, 255, 255, 0.08)" }}
      >
        <Text c="dimmed" ta="center">No assets found.</Text>
      </Paper>
    );
  }

  return (
    <Stack gap="xs">
      {assets.map((asset) => (
        <Paper
          key={asset.id}
          withBorder
          radius="lg"
          p="sm"
          bg="rgba(18, 20, 26, 0.92)"
          style={{ borderColor: "rgba(255, 255, 255, 0.08)" }}
        >
          <Group align="flex-start" wrap="nowrap" gap="sm">
            <AssetThumb asset={asset} />

            <Stack gap={8} style={{ flex: 1, minWidth: 0 }}>
              <Group justify="space-between" align="flex-start" gap="sm" wrap="nowrap">
                <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                  <Link href={`/admin/media/${asset.id}`} style={{ textDecoration: "none" }}>
                    <Text fw={700} size="sm" truncate>
                      {asset.title}
                    </Text>
                  </Link>
                  <Text size="xs" c="dimmed" truncate>
                    {asset.filename || asset.slug}
                  </Text>
                  <Text size="xs" c="dimmed" truncate>
                    {asset.object_key}
                  </Text>
                </Stack>

                <Group gap={6} wrap="wrap" justify="flex-end">
                  <Badge variant="light">{asset.status}</Badge>
                  <Badge variant="outline">{asset.visibility}</Badge>
                  <Badge color={integrityColor(asset.integrity_status)} variant="light">
                    {asset.integrity_status}
                  </Badge>
                  <Badge variant="outline">{asset.lifecycle_status}</Badge>
                  <AssetActionMenu
                    assetId={asset.id}
                    editable={editable}
                    trashed={asset.lifecycle_status === "trashed"}
                  />
                </Group>
              </Group>

              {asset.tags.length > 0 && (
                <PillGroup>
                  {asset.tags.map((tag) => (
                    <Pill key={tag}>{tag}</Pill>
                  ))}
                </PillGroup>
              )}

              <Group gap="xs" wrap="wrap">
                <Badge variant="dot" color={asset.media_type === "video" ? "grape" : "blue"}>
                  {asset.media_type}
                </Badge>
                {asset.warnings.length > 0 ? (
                  <Badge color="yellow" variant="light">
                    {asset.warnings.length} warning{asset.warnings.length === 1 ? "" : "s"}
                  </Badge>
                ) : asset.integrity_status === "missing" ? (
                  <Badge color="red" variant="light">Missing file</Badge>
                ) : (
                  <Text size="xs" c="dimmed">No current warnings</Text>
                )}
              </Group>
            </Stack>
          </Group>
        </Paper>
      ))}
    </Stack>
  );
}
