import { Card, Stack, Text, Title } from "@mantine/core";

import { AssetFilters } from "@/components/admin/AssetFilters";
import { AssetTable } from "@/components/admin/AssetTable";
import { MediaUploadForm } from "@/components/admin/MediaUploadForm";
import { canEdit, requireCmsSession } from "@/lib/authz";
import { getMediaCatalog } from "@/lib/media/service";

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
    lifecycleStatus: typeof params.lifecycleStatus === "string" ? params.lifecycleStatus : "active",
    integrityStatus: typeof params.integrityStatus === "string" ? params.integrityStatus : "all",
  });

  return (
    <Stack gap="xl">
      <Stack gap={4}>
        <Title order={1}>Media library</Title>
        <Text c="dimmed">
          Browse, filter, upload, and review canonical media assets. Guests are read-only.
        </Text>
      </Stack>

      <MediaUploadForm editable={canEdit(session.role)} />

      <Card withBorder radius="lg" p="lg">
        <Stack gap="lg">
          <AssetFilters />
          <AssetTable assets={assets as never[]} editable={canEdit(session.role)} />
        </Stack>
      </Card>
    </Stack>
  );
}
