import Link from "next/link";
import { AppShell, AppShellMain, AppShellNavbar, Badge, Group, NavLink, Stack, Text, Title } from "@mantine/core";

import { LogoutButton } from "@/components/admin/LogoutButton";
import { requireCmsSession } from "@/lib/authz";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireCmsSession();

  return (
    <AppShell
      padding="sm"
      navbar={{
        width: 224,
        breakpoint: "sm",
      }}
      styles={{
        main: {
          background: "transparent",
        },
        navbar: {
          background: "rgba(15, 17, 21, 0.92)",
          borderRight: "1px solid rgba(255, 255, 255, 0.08)",
          backdropFilter: "blur(14px)",
        },
      }}
    >
      <AppShellNavbar p="sm">
        <Stack gap="sm" h="100%">
          <Stack gap={2}>
            <Group justify="space-between" align="start">
              <div>
                <Title order={4}>CMS</Title>
              </div>
              <Badge variant="light" color="gray">
                {session.role}
              </Badge>
            </Group>
            <Text size="xs" c="dimmed">
              Signed in as {session.username} ({session.role})
            </Text>
          </Stack>
          <Stack gap={4}>
            <NavLink component={Link} href="/admin" label="Dashboard" variant="filled" />
            <NavLink component={Link} href="/admin/media" label="Media" variant="filled" />
            <NavLink component={Link} href="/admin/media/sync" label="Sync & review" variant="filled" />
          </Stack>
          <Group mt="auto">
            <LogoutButton />
          </Group>
        </Stack>
      </AppShellNavbar>
      <AppShellMain
        style={{
          maxWidth: 1440,
          width: "100%",
          margin: "0 auto",
        }}
      >
        {children}
      </AppShellMain>
    </AppShell>
  );
}
