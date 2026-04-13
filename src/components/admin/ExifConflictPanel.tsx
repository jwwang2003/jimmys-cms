"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Alert,
  Button,
  Group,
  Paper,
  Stack,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
} from "@mantine/core";

type Conflict = {
  id: number;
  assetId: number;
  assetTitle: string;
  distanceMeters: number | null;
  existingLocation: {
    source?: string | null;
    lat?: number | null;
    lng?: number | null;
  };
  candidateLocation: {
    source?: string | null;
    lat?: number | null;
    lng?: number | null;
  };
};

export function ExifConflictPanel({
  editable,
  conflicts,
}: {
  editable: boolean;
  conflicts: Conflict[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);

  async function resolve(conflictId: number, resolution: "keep_exif" | "keep_existing") {
    if (!editable) return;
    setActiveId(conflictId);
    setError(null);
    try {
      const response = await fetch("/api/admin/media/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolveLocationConflict", conflictId, resolution }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to resolve EXIF conflict");
      }
      router.refresh();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Failed to resolve EXIF conflict");
    } finally {
      setActiveId(null);
    }
  }

  return (
    <Paper withBorder radius="lg" p="lg">
      <Stack gap="sm">
        <Text fw={600}>EXIF Location Conflicts</Text>
        <Text size="sm" c="dimmed">
          If spreadsheet/manual location and embedded photo GPS do not match, EXIF stays primary until you resolve it.
        </Text>
        {error && <Alert color="red" variant="light">{error}</Alert>}
        {conflicts.length === 0 && <Text size="sm" c="dimmed">No pending EXIF location conflicts.</Text>}
        {conflicts.length > 0 && (
          <Table withTableBorder striped>
            <TableThead>
              <TableTr>
                <TableTh>Asset</TableTh>
                <TableTh>Existing</TableTh>
                <TableTh>EXIF</TableTh>
                <TableTh>Distance</TableTh>
                <TableTh>Resolution</TableTh>
              </TableTr>
            </TableThead>
            <TableTbody>
              {conflicts.map((conflict) => (
                <TableTr key={conflict.id}>
                  <TableTd>{conflict.assetTitle || `Asset #${conflict.assetId}`}</TableTd>
                  <TableTd>
                    <Text size="sm">{conflict.existingLocation.source || "existing"}</Text>
                    <Text size="xs" c="dimmed">
                      {formatCoords(conflict.existingLocation.lat, conflict.existingLocation.lng)}
                    </Text>
                  </TableTd>
                  <TableTd>
                    <Text size="sm">{conflict.candidateLocation.source || "exif"}</Text>
                    <Text size="xs" c="dimmed">
                      {formatCoords(conflict.candidateLocation.lat, conflict.candidateLocation.lng)}
                    </Text>
                  </TableTd>
                  <TableTd>{conflict.distanceMeters == null ? "Unknown" : `${Math.round(conflict.distanceMeters)} m`}</TableTd>
                  <TableTd>
                    {editable ? (
                      <Group gap="xs">
                        <Button
                          size="xs"
                          onClick={() => resolve(conflict.id, "keep_exif")}
                          loading={activeId === conflict.id}
                        >
                          Keep EXIF
                        </Button>
                        <Button
                          size="xs"
                          variant="light"
                          onClick={() => resolve(conflict.id, "keep_existing")}
                          loading={activeId === conflict.id}
                        >
                          Keep existing
                        </Button>
                      </Group>
                    ) : (
                      <Text size="sm" c="dimmed">Editors can resolve</Text>
                    )}
                  </TableTd>
                </TableTr>
              ))}
            </TableTbody>
          </Table>
        )}
      </Stack>
    </Paper>
  );
}

function formatCoords(lat?: number | null, lng?: number | null) {
  if (lat == null || lng == null) return "No coordinates";
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}
