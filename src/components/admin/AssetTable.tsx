"use client";

import Link from "next/link";
import { Badge, Group, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text } from "@mantine/core";

type AssetRow = {
  id: number;
  title: string;
  slug: string;
  media_type: string;
  status: string;
  visibility: string;
  tags: string[];
  warnings: string[];
};

export function AssetTable({ assets }: { assets: AssetRow[] }) {
  return (
    <Table striped highlightOnHover withTableBorder>
      <TableThead>
        <TableTr>
          <TableTh>Asset</TableTh>
          <TableTh>Type</TableTh>
          <TableTh>Status</TableTh>
          <TableTh>Visibility</TableTh>
          <TableTh>Tags</TableTh>
          <TableTh>Warnings</TableTh>
        </TableTr>
      </TableThead>
      <TableTbody>
        {assets.length === 0 && (
          <TableTr>
            <TableTd colSpan={6}>
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
              <Group gap={6}>
                {asset.tags.map((tag) => (
                  <Badge key={tag} variant="outline">{tag}</Badge>
                ))}
              </Group>
            </TableTd>
            <TableTd>
              {asset.warnings.length > 0 ? (
                <Badge color="yellow" variant="light">{asset.warnings.length} warning{asset.warnings.length === 1 ? "" : "s"}</Badge>
              ) : (
                <Text size="sm" c="dimmed">Clean</Text>
              )}
            </TableTd>
          </TableTr>
        ))}
      </TableTbody>
    </Table>
  );
}
