"use client";

import Link from "next/link";
import { Badge, Group, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text } from "@mantine/core";
import { AssetActionMenu } from "./AssetActionMenu";

type AssetRow = {
  id: number;
  title: string;
  slug: string;
  media_type: string;
  status: string;
  visibility: string;
  lifecycle_status: string;
  integrity_status: string;
  last_verified_at?: number | null;
  tags: string[];
  warnings: string[];
};

function integrityColor(status: string) {
  if (status === "missing") return "red";
  if (status === "warning" || status === "invalid") return "yellow";
  return "green";
}

export function AssetTable({ assets, editable }: { assets: AssetRow[]; editable: boolean }) {
  return (
    <Table striped highlightOnHover withTableBorder>
      <TableThead>
        <TableTr>
          <TableTh>Asset</TableTh>
          <TableTh>Type</TableTh>
          <TableTh>Status</TableTh>
          <TableTh>Visibility</TableTh>
          <TableTh>Integrity</TableTh>
          <TableTh>Lifecycle</TableTh>
          <TableTh>Tags</TableTh>
          <TableTh>Warnings</TableTh>
          <TableTh>Actions</TableTh>
        </TableTr>
      </TableThead>
      <TableTbody>
        {assets.length === 0 && (
          <TableTr>
            <TableTd colSpan={9}>
              <Text c="dimmed" ta="center">No assets found.</Text>
            </TableTd>
          </TableTr>
        )}
        {assets.map((asset) => (
          <TableTr key={asset.id}>
            <TableTd>
              <Link href={`/admin/media/${asset.id}`}>{asset.title}</Link>
              <Text size="xs" c="dimmed">{asset.slug}</Text>
            </TableTd>
            <TableTd>{asset.media_type}</TableTd>
            <TableTd><Badge variant="light">{asset.status}</Badge></TableTd>
            <TableTd>{asset.visibility}</TableTd>
            <TableTd>
              <Badge color={integrityColor(asset.integrity_status)} variant="light">
                {asset.integrity_status}
              </Badge>
            </TableTd>
            <TableTd>
              <Badge variant="outline">{asset.lifecycle_status}</Badge>
            </TableTd>
            <TableTd>
              <Group gap={6}>
                {asset.tags.map((tag) => (
                  <Badge key={tag} variant="outline">{tag}</Badge>
                ))}
              </Group>
            </TableTd>
            <TableTd>
              {asset.warnings.length > 0 ? (
                <Badge color="yellow" variant="light">{asset.warnings.length} warning{asset.warnings.length === 1 ? "" : "s"}</Badge>
              ) : asset.integrity_status === "missing" ? (
                <Badge color="red" variant="light">Missing file</Badge>
              ) : asset.integrity_status === "warning" || asset.integrity_status === "invalid" ? (
                <Badge color="yellow" variant="light">Integrity warning</Badge>
              ) : (
                <Text size="sm" c="dimmed">Clean</Text>
              )}
            </TableTd>
            <TableTd>
              <AssetActionMenu
                assetId={asset.id}
                editable={editable}
                trashed={asset.lifecycle_status === "trashed"}
              />
            </TableTd>
          </TableTr>
        ))}
      </TableTbody>
    </Table>
  );
}
