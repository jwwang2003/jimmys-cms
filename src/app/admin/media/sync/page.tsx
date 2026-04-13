import { Card, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text, Title } from "@mantine/core";

import { BatchIngestForm } from "@/components/admin/BatchIngestForm";
import { ExifConflictPanel } from "@/components/admin/ExifConflictPanel";
import { GeocodeRefreshPanel } from "@/components/admin/GeocodeRefreshPanel";
import { IntegrityCheckPanel } from "@/components/admin/IntegrityCheckPanel";
import { LocationImportForm } from "@/components/admin/LocationImportForm";
import { SpreadsheetImportForm } from "@/components/admin/SpreadsheetImportForm";
import { SyncRunner } from "@/components/admin/SyncRunner";
import { canEdit, requireCmsSession } from "@/lib/authz";
import { listStorageReviewItems } from "@/lib/media/repository";
import { getPendingExifLocationConflicts } from "@/lib/media/service";

export default async function MediaSyncPage() {
  const session = await requireCmsSession();
  const reviewItems = listStorageReviewItems(50);
  const pendingExifConflicts = getPendingExifLocationConflicts(20);

  return (
    <Stack gap="xl">
      <Stack gap={4}>
        <Title order={1}>Sync and review</Title>
        <Text c="dimmed">
          Sync messy S3 data into the CMS without aborting on bad objects. Warning and invalid rows stay reviewable.
        </Text>
      </Stack>

      <SyncRunner editable={canEdit(session.role)} />
      <IntegrityCheckPanel editable={canEdit(session.role)} />
      <GeocodeRefreshPanel editable={canEdit(session.role)} scope="bulk" />
      <ExifConflictPanel editable={canEdit(session.role)} conflicts={pendingExifConflicts} />
      <BatchIngestForm editable={canEdit(session.role)} />
      <SpreadsheetImportForm editable={canEdit(session.role)} />
      <LocationImportForm editable={canEdit(session.role)} />

      <Card withBorder radius="lg" p="lg">
        <Stack gap="md">
          <Title order={3}>Review queue</Title>
          <Table withTableBorder striped>
            <TableThead>
              <TableTr>
                <TableTh>Object key</TableTh>
                <TableTh>Status</TableTh>
                <TableTh>Warnings</TableTh>
                <TableTh>Last error</TableTh>
              </TableTr>
            </TableThead>
            <TableTbody>
              {reviewItems.length === 0 && (
                <TableTr>
                  <TableTd colSpan={4}>
                    <Text c="dimmed" ta="center">No review items yet.</Text>
                  </TableTd>
                </TableTr>
              )}
              {reviewItems.map((item) => (
                <TableTr key={String(item.id)}>
                  <TableTd>{String(item.object_key)}</TableTd>
                  <TableTd>{String(item.sync_status)}</TableTd>
                  <TableTd>{Array.isArray(item.warnings) ? item.warnings.join(", ") : ""}</TableTd>
                  <TableTd>{String(item.last_error || "")}</TableTd>
                </TableTr>
              ))}
            </TableTbody>
          </Table>
        </Stack>
      </Card>
    </Stack>
  );
}
