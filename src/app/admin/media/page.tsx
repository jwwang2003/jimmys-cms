import Link from "next/link";
import { Badge, Card, Group, Stack, Text, Title } from "@mantine/core";

import { AssetFilters } from "@/components/admin/AssetFilters";
import { AssetTable } from "@/components/admin/AssetTable";
import { MediaUploadForm } from "@/components/admin/MediaUploadForm";
import { canEdit, requireCmsSession } from "@/lib/authz";
import { getMediaCatalog } from "@/lib/media/service";

function pickLifecycleStatus(value: string | string[] | undefined) {
  if (value === "active" || value === "trashed" || value === "all") {
    return value;
  }
  return "active";
}

function pickIntegrityStatus(value: string | string[] | undefined) {
  if (value === "ok" || value === "missing" || value === "warning" || value === "invalid" || value === "all") {
    return value;
  }
  return "all";
}

export default async function AdminMediaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireCmsSession();
  const params = await searchParams;
  const assets = getMediaCatalog({
    query: typeof params.query === "string" ? params.query : "",
    mediaType: typeof params.mediaType === "string" ? params.mediaType : "all",
    status: typeof params.status === "string" ? params.status : "all",
    visibility: typeof params.visibility === "string" ? params.visibility : "all",
    lifecycleStatus: pickLifecycleStatus(params.lifecycleStatus),
    integrityStatus: pickIntegrityStatus(params.integrityStatus),
  });

  return (
    <Stack gap="lg">
      <Stack gap={6}>
        <Group justify="space-between" align="end">
          <div>
            <Text size="xs" tt="uppercase" c="dimmed" fw={700} style={{ letterSpacing: "0.08em" }}>
              Library
            </Text>
            <Title order={1}>Media</Title>
          </div>
          <Badge component={Link} href="/admin/media?lifecycleStatus=trashed" variant="light" color="gray">
            Open recycle bin
          </Badge>
        </Group>
        <Text size="sm" c="dimmed">
          Browse, filter, upload, and review canonical media assets. Guests are read-only.
        </Text>
      </Stack>

      <MediaUploadForm editable={canEdit(session.role)} />

      <Card
        withBorder
        radius="lg"
        p="md"
        bg="rgba(18, 20, 26, 0.92)"
        style={{ borderColor: "rgba(255, 255, 255, 0.08)" }}
      >
        <Stack gap="md">
          <AssetFilters />
          <AssetTable assets={assets as never[]} editable={canEdit(session.role)} />
        </Stack>
      </Card>
    </Stack>
  );
}
