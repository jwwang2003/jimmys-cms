"use client";

import { Anchor, Badge, Card, Group, Paper, Stack, Table, Text, Title } from "@mantine/core";

type SerializableUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

type Props = {
  users: SerializableUser[];
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function UserDirectoryTable({ users }: Props) {
  return (
    <Stack component="section" gap="xl" px={{ base: "md", md: "xl" }} py="xl">
      <Stack gap={4}>
        <Title order={2}>Server-only user directory</Title>
        <Text c="dimmed">Rendering happens on the server; Mantine handles the client view.</Text>
      </Stack>

      <Group justify="space-between" wrap="wrap">
        <Stack gap={0}>
          <Text fw={600} size="lg">
            {users.length} total user{users.length === 1 ? "" : "s"}
          </Text>
          <Text size="sm" c="dimmed">
            Data sourced from the Better Auth `user` table.
          </Text>
        </Stack>
        <Anchor href="/admin/users" underline="hover">
          View interactive workspace →
        </Anchor>
      </Group>

      <Paper withBorder p="md" radius="lg" shadow="sm">
        <Table highlightOnHover verticalSpacing="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Email</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Created</Table.Th>
              <Table.Th>Updated</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {users.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={5}>
                  <Text ta="center" c="dimmed">
                    No users found in the database.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
            {users.map((record) => (
              <Table.Tr key={record.id}>
                <Table.Td>
                  <Stack gap={0}>
                    <Text fw={600}>{record.name}</Text>
                    <Text size="sm" c="dimmed">
                      {record.id}
                    </Text>
                  </Stack>
                </Table.Td>
                <Table.Td>{record.email}</Table.Td>
                <Table.Td>
                  <Badge color={record.emailVerified ? "green" : "yellow"} variant="light">
                    {record.emailVerified ? "Verified" : "Pending"}
                  </Badge>
                </Table.Td>
                <Table.Td>{formatDate(record.createdAt)}</Table.Td>
                <Table.Td>{formatDate(record.updatedAt)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>

      <Card withBorder radius="lg" p="lg">
        <Stack gap="xs">
          <Title order={4}>Why server-only?</Title>
          <Text size="sm">
            The data is fetched in a server component, while this client component is responsible for Mantine rendering with SSR
            support.
          </Text>
        </Stack>
      </Card>
    </Stack>
  );
}
