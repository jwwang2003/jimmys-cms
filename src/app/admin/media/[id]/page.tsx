import Link from "next/link";
import { Stack, Text, Title } from "@mantine/core";
import { notFound } from "next/navigation";

import { AssetEditor } from "@/components/admin/AssetEditor";
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
    <Stack gap="lg">
      <div>
        <Link href="/admin/media">← Back to media</Link>
      </div>
      <div>
        <Title order={1}>{asset.title}</Title>
        <Text c="dimmed">{asset.object_key}</Text>
      </div>
      <AssetEditor asset={asset as never} editable={canEdit(session.role)} />
    </Stack>
  );
}
