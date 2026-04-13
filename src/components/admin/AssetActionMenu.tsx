"use client";

import { useRouter } from "next/navigation";
import { Button, Menu } from "@mantine/core";

export function AssetActionMenu({
  assetId,
  editable,
  trashed,
}: {
  assetId: number;
  editable: boolean;
  trashed: boolean;
}) {
  const router = useRouter();

  async function run(action: string) {
    if (!editable) return;

    const response = await fetch("/api/admin/media/actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action, assetId }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.error || "Action failed");
    }

    router.refresh();
  }

  if (!editable) {
    return null;
  }

  return (
    <Menu shadow="md" width={180}>
      <Menu.Target>
        <Button size="xs" variant="light">Actions</Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item onClick={() => run("verify")}>Verify file</Menu.Item>
        {!trashed && <Menu.Item onClick={() => run("archive")}>Archive</Menu.Item>}
        {!trashed && <Menu.Item onClick={() => run("trash")}>Move to trash</Menu.Item>}
        {trashed && <Menu.Item onClick={() => run("restore")}>Restore</Menu.Item>}
        {trashed && <Menu.Item color="red" onClick={() => run("permadelete")}>Permanent delete</Menu.Item>}
      </Menu.Dropdown>
    </Menu>
  );
}
