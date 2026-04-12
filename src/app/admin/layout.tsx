import Link from "next/link";
import { AppShell, AppShellMain, AppShellNavbar, Group, NavLink, Stack, Text, Title } from "@mantine/core";

import { LogoutButton } from "@/components/admin/LogoutButton";
import { requireCmsSession } from "@/lib/authz";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireCmsSession();

  return (
    <AppShell
      padding="md"
      navbar={{
        width: 260,
        breakpoint: "sm",
      }}
    >
      <AppShellNavbar p="md">
        <Stack gap="md">
          <div>
            <Title order={3}>CMS</Title>
            <Text size="sm" c="dimmed">
              Signed in as {session.username} ({session.role})
            </Text>
          </div>
          <NavLink component={Link} href="/admin" label="Dashboard" />
          <NavLink component={Link} href="/admin/media" label="Media" />
          <NavLink component={Link} href="/admin/media/sync" label="Sync & review" />
          <Group mt="auto">
            <LogoutButton />
          </Group>
        </Stack>
      </AppShellNavbar>
      <AppShellMain>{children}</AppShellMain>
    </AppShell>
  );
}
