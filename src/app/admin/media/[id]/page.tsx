import Link from "next/link";
import { Badge, Group, Pill, PillGroup, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { notFound } from "next/navigation";

import { AssetEditor } from "@/components/admin/AssetEditor";
import { AssetPreviewCard } from "@/components/admin/AssetPreviewCard";
import { canEdit, requireCmsSession } from "@/lib/authz";
import { getMediaDetail } from "@/lib/media/service";

export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireCmsSession();
  const { id } = await params;
  const asset = getMediaDetail(Number(id));
  if (!asset) {
    notFound();
  }

  return (
    <Stack gap="md">
      <div>
        <Link href="/admin/media">← Back to media</Link>
      </div>
      <Stack gap={6}>
        <Title order={1}>{asset.title}</Title>
        <Text size="sm" c="dimmed">{asset.filename || asset.object_key}</Text>
        <Text size="xs" c="dimmed">{asset.object_key}</Text>
        <Group gap="xs">
          <Badge variant="light">{String(asset.status)}</Badge>
          <Badge variant="outline">{String(asset.visibility)}</Badge>
          <Badge variant="light" color={asset.integrity_status === "ok" ? "green" : asset.integrity_status === "missing" ? "red" : "yellow"}>
            {String(asset.integrity_status)}
          </Badge>
        </Group>
        <Text size="xs" c="dimmed">
          Last verified: {asset.last_verified_at ? new Date(asset.last_verified_at).toLocaleString() : "Never"}
        </Text>
        {asset.tags.length > 0 && (
          <PillGroup>
            {asset.tags.map((tag) => (
              <Pill key={tag}>{tag}</Pill>
            ))}
          </PillGroup>
        )}
      </Stack>
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md" verticalSpacing="md">
        <AssetPreviewCard asset={asset} />
        <AssetEditor asset={asset as never} editable={canEdit(session.role)} />
      </SimpleGrid>
    </Stack>
  );
}
