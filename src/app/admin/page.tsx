import Link from "next/link";
import { Card, Group, SimpleGrid, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text, Title } from "@mantine/core";

import { requireCmsSession } from "@/lib/authz";
import { getMediaDashboard } from "@/lib/media/service";

function StatCard({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <Card withBorder radius="lg" p="lg">
      <Stack gap={4}>
        <Text size="sm" c="dimmed">{label}</Text>
        <Text fw={800} fz={30}>{value}</Text>
        <Text size="sm" c="dimmed">{detail}</Text>
      </Stack>
    </Card>
  );
}

export default async function AdminPage() {
  const session = await requireCmsSession();
  const { stats, reviewItems } = getMediaDashboard();

  return (
    <Stack gap="xl">
      <Stack gap={4}>
        <Title order={1}>Assets</Title>
        <Text c="dimmed">
          Media dashboard for uploads, sync review, and location coverage. Guests can browse; admins and users can edit.
        </Text>
      </Stack>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
        <StatCard label="Total assets" value={stats.assets} detail="Images and videos tracked in SQLite." />
        <StatCard label="Needs review" value={stats.review} detail="Draft and review-stage assets." />
        <StatCard label="Warning items" value={stats.warnings} detail="S3 objects normalized with warnings." />
        <StatCard label="Invalid objects" value={stats.invalid} detail="Bucket data kept for review only." />
        <StatCard label="Missing location" value={stats.missingLocation} detail="Assets without a primary location." />
        <StatCard label="Published" value={stats.published} detail={`Current role: ${session.role}`} />
      </SimpleGrid>

      <Card withBorder radius="lg" p="lg">
        <Group justify="space-between" mb="md">
          <div>
            <Title order={3}>Recent review queue</Title>
            <Text size="sm" c="dimmed">Objects that need follow-up after sync.</Text>
          </div>
          <Link href="/admin/media/sync">Open sync workspace</Link>
        </Group>
        <Table withTableBorder>
          <TableThead>
            <TableTr>
              <TableTh>Object key</TableTh>
              <TableTh>Status</TableTh>
              <TableTh>Warnings</TableTh>
            </TableTr>
          </TableThead>
          <TableTbody>
            {reviewItems.length === 0 && (
              <TableTr>
                <TableTd colSpan={3}>
                  <Text c="dimmed" ta="center">No warning or invalid objects yet.</Text>
                </TableTd>
              </TableTr>
            )}
            {reviewItems.map((item) => (
              <TableTr key={String(item.id)}>
                <TableTd>{String(item.object_key)}</TableTd>
                <TableTd>{String(item.sync_status)}</TableTd>
                <TableTd>{Array.isArray(item.warnings) ? item.warnings.join(", ") : ""}</TableTd>
              </TableTr>
            ))}
          </TableTbody>
        </Table>
      </Card>
    </Stack>
  );
}
