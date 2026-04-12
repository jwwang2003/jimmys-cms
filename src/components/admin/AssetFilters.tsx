"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Button, Group, Select, TextInput } from "@mantine/core";
import { useState } from "react";

export function AssetFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("query") || "");
  const [mediaType, setMediaType] = useState(searchParams.get("mediaType") || "all");
  const [status, setStatus] = useState(searchParams.get("status") || "all");
  const [visibility, setVisibility] = useState(searchParams.get("visibility") || "all");

  function apply() {
    const params = new URLSearchParams();
    if (query.trim()) params.set("query", query.trim());
    if (mediaType !== "all") params.set("mediaType", mediaType);
    if (status !== "all") params.set("status", status);
    if (visibility !== "all") params.set("visibility", visibility);
    router.push(`/admin/media${params.toString() ? `?${params.toString()}` : ""}`);
  }

  return (
    <Group align="end" wrap="wrap">
      <TextInput label="Search" placeholder="title, slug, key" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
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
      <Button onClick={apply}>Apply</Button>
    </Group>
  );
}
