"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Group, Paper, Stack, Text } from "@mantine/core";

type AssetLocation = {
  raw_address?: string | null;
  formatted_address?: string | null;
  lat?: number | null;
  lng?: number | null;
  source?: string | null;
  status?: string | null;
};

export function GeocodeRefreshPanel({
  editable,
  scope,
  assetId,
  locations = [],
  onAssetRefreshed,
}: {
  editable: boolean;
  scope: "asset" | "bulk";
  assetId?: number;
  locations?: AssetLocation[];
  onAssetRefreshed?: (asset: {
    locations?: AssetLocation[];
  }) => void;
}) {
  const router = useRouter();
  const [loadingMode, setLoadingMode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const primaryLocation = locations[0];

  async function run(mode: "pending" | "force" = "pending") {
    if (!editable) return;

    setLoadingMode(mode);
    setError(null);
    setMessage(null);

    try {
      const response =
        scope === "asset"
          ? await fetch(`/api/admin/media/${assetId}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "refreshGeocode" }),
            })
          : await fetch("/api/admin/media/actions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "refreshManyGeocodes", mode }),
            });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Geocode refresh failed");
      }

      if (scope === "asset" && payload?.asset && onAssetRefreshed) {
        onAssetRefreshed(payload.asset);
      }

      const summary = payload?.summary || {};
      setMessage(
        summary.message ||
          `Checked ${summary.checked || 0}. Updated ${summary.updated || 0}. Failed ${summary.failed || 0}. Skipped ${summary.skipped || 0}.`
      );
      router.refresh();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Geocode refresh failed");
    } finally {
      setLoadingMode(null);
    }
  }

  const content = (
    <Stack gap="sm">
      <div>
        <Text fw={600}>{scope === "asset" ? "Geolocation refresh" : "Google geocode refresh"}</Text>
        <Text size="sm" c="dimmed">
          {scope === "asset"
            ? "Re-run Google Maps geocoding for this asset's primary non-EXIF location."
            : "Refresh pending or failed spreadsheet/manual geocodes without touching EXIF locations."}
        </Text>
      </div>

      {scope === "asset" && (
        <Stack gap={2}>
          <Text size="sm">Source: {primaryLocation?.source || "No location"}</Text>
          <Text size="sm">Status: {primaryLocation?.status || "Unknown"}</Text>
          <Text size="sm" c="dimmed">
            {primaryLocation?.raw_address || primaryLocation?.formatted_address || "No address available"}
          </Text>
        </Stack>
      )}

      {!editable && (
        <Alert color="yellow" variant="light">
          Guests can review location status but cannot refresh geocodes.
        </Alert>
      )}
      {error && <Alert color="red" variant="light">{error}</Alert>}
      {message && <Alert color="green" variant="light">{message}</Alert>}

      <Group justify="end">
        {scope === "bulk" && (
          <Button
            variant="light"
            onClick={() => run("force")}
            loading={loadingMode === "force"}
            disabled={!editable}
          >
            Force refresh all
          </Button>
        )}
        <Button onClick={() => run("pending")} loading={loadingMode === "pending"} disabled={!editable}>
          {scope === "asset" ? "Refresh geolocation" : "Refresh pending geocodes"}
        </Button>
      </Group>
    </Stack>
  );

  if (scope === "bulk") {
    return (
      <Paper withBorder radius="lg" p="lg">
        {content}
      </Paper>
    );
  }

  return content;
}
