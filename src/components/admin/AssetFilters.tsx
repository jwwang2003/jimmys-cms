"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Button, Grid, Select, TextInput } from "@mantine/core";
import { useState } from "react";

export function AssetFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("query") || "");
  const [mediaType, setMediaType] = useState(searchParams.get("mediaType") || "all");
  const [status, setStatus] = useState(searchParams.get("status") || "all");
  const [visibility, setVisibility] = useState(searchParams.get("visibility") || "all");
  const [lifecycleStatus, setLifecycleStatus] = useState(searchParams.get("lifecycleStatus") || "active");
  const [integrityStatus, setIntegrityStatus] = useState(searchParams.get("integrityStatus") || "all");

  function apply() {
    const params = new URLSearchParams();
    if (query.trim()) params.set("query", query.trim());
    if (mediaType !== "all") params.set("mediaType", mediaType);
    if (status !== "all") params.set("status", status);
    if (visibility !== "all") params.set("visibility", visibility);
    if (lifecycleStatus !== "active") params.set("lifecycleStatus", lifecycleStatus);
    if (integrityStatus !== "all") params.set("integrityStatus", integrityStatus);
    router.push(`/admin/media${params.toString() ? `?${params.toString()}` : ""}`);
  }

  return (
    <Grid gutter="xs" align="end">
      <Grid.Col span={{ base: 12, md: 4 }}>
        <TextInput label="Search" placeholder="title, slug, key" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
      </Grid.Col>
      <Grid.Col span={{ base: 6, md: 2 }}>
        <Select
          label="Type"
          value={mediaType}
          onChange={(value) => setMediaType(value || "all")}
          data={[
            { value: "all", label: "All types" },
            { value: "image", label: "Images" },
            { value: "video", label: "Videos" },
          ]}
        />
      </Grid.Col>
      <Grid.Col span={{ base: 6, md: 2 }}>
        <Select
          label="Status"
          value={status}
          onChange={(value) => setStatus(value || "all")}
          data={[
            { value: "all", label: "All statuses" },
            { value: "draft", label: "Draft" },
            { value: "review", label: "Review" },
            { value: "published", label: "Published" },
            { value: "archived", label: "Archived" },
          ]}
        />
      </Grid.Col>
      <Grid.Col span={{ base: 6, md: 2 }}>
        <Select
          label="Visibility"
          value={visibility}
          onChange={(value) => setVisibility(value || "all")}
          data={[
            { value: "all", label: "All visibility" },
            { value: "private", label: "Private" },
            { value: "internal", label: "Internal" },
            { value: "public", label: "Public" },
          ]}
        />
      </Grid.Col>
      <Grid.Col span={{ base: 6, md: 2 }}>
        <Select
          label="Lifecycle"
          value={lifecycleStatus}
          onChange={(value) => setLifecycleStatus(value || "active")}
          data={[
            { value: "active", label: "Active" },
            { value: "trashed", label: "Trashed" },
            { value: "all", label: "All lifecycle" },
          ]}
        />
      </Grid.Col>
      <Grid.Col span={{ base: 8, md: 3 }}>
        <Select
          label="Integrity"
          value={integrityStatus}
          onChange={(value) => setIntegrityStatus(value || "all")}
          data={[
            { value: "all", label: "All integrity" },
            { value: "ok", label: "OK" },
            { value: "missing", label: "Missing" },
            { value: "warning", label: "Warning" },
            { value: "invalid", label: "Invalid" },
          ]}
        />
      </Grid.Col>
      <Grid.Col span={{ base: 4, md: 1 }}>
        <Button fullWidth onClick={apply}>Apply</Button>
      </Grid.Col>
    </Grid>
  );
}
