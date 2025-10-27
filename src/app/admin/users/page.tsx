/*
 * Admin user management workspace
 * --------------------------------
 * Provides a responsive, client-side directory UI for monitoring and organizing
 * accounts stored in the `users` table defined in Drizzle. This view focuses on
 * user-facing needs (filters, role breakdown, quick actions) and can be wired
 * to real data sources later.
 */
"use client";

import { useMemo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";

type UserRole = "admin" | "creator" | "user" | "guest";
type UserStatus = "active" | "pending" | "suspended";

type UserRecord = {
  id: number;
  username: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  location?: string;
  tags: string[];
  mediaCount: number;
  lastActivity: string;
};

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  creator: "Creator",
  user: "User",
  guest: "Guest",
};

const ROLE_COLORS: Record<UserRole, string> = {
  admin: "grape",
  creator: "indigo",
  user: "blue",
  guest: "gray",
};

const STATUS_COLORS: Record<UserStatus, string> = {
  active: "green",
  pending: "yellow",
  suspended: "red",
};

const MOCK_USERS: UserRecord[] = [
  {
    id: 101,
    username: "jane.smith",
    email: "jane.smith@example.com",
    role: "admin",
    status: "active",
    location: "Brooklyn, NY",
    tags: ["editorial", "press"],
    mediaCount: 182,
    lastActivity: "2 hours ago",
  },
  {
    id: 109,
    username: "mason.cho",
    email: "mason.cho@example.com",
    role: "creator",
    status: "active",
    location: "Seoul, South Korea",
    tags: ["video", "events"],
    mediaCount: 96,
    lastActivity: "18 minutes ago",
  },
  {
    id: 127,
    username: "elena.ramos",
    email: "elena.ramos@example.com",
    role: "user",
    status: "pending",
    location: "Lisbon, Portugal",
    tags: ["community"],
    mediaCount: 12,
    lastActivity: "Pending invite",
  },
  {
    id: 133,
    username: "guest.photobooth",
    email: "guest.photobooth@example.com",
    role: "guest",
    status: "active",
    location: "On-site kiosk",
    tags: ["events"],
    mediaCount: 54,
    lastActivity: "Last night",
  },
  {
    id: 141,
    username: "nora.ives",
    email: "nora.ives@example.com",
    role: "creator",
    status: "suspended",
    location: "Austin, TX",
    tags: ["photo", "geo"],
    mediaCount: 0,
    lastActivity: "Suspended",
  },
];

const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" style={{ display: "block" }}>
    <path
      fill="currentColor"
      d="M10.5 3a7.5 7.5 0 0 1 5.913 12.09l4.248 4.248a1 1 0 0 1-1.414 1.414l-4.248-4.248A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11a5.5 5.5 0 0 0 0-11z"
    />
  </svg>
);

const DotsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" style={{ display: "block" }}>
    <path fill="currentColor" d="M12 7a2 2 0 1 1 0-4a2 2 0 0 1 0 4zm0 7a2 2 0 1 1 0-4a2 2 0 0 1 0 4zm0 7a2 2 0 1 1 0-4a2 2 0 0 1 0 4z" />
  </svg>
);

export default function AdminUserManagementPage() {
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string | null>("all");
  const [statusFilter, setStatusFilter] = useState<string | null>("all");

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return MOCK_USERS.filter((user) => {
      const matchesQuery =
        !normalizedQuery ||
        user.username.toLowerCase().includes(normalizedQuery) ||
        user.email.toLowerCase().includes(normalizedQuery) ||
        user.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery));

      const matchesRole = roleFilter === "all" || user.role === roleFilter;
      const matchesStatus = statusFilter === "all" || user.status === statusFilter;
      return matchesQuery && matchesRole && matchesStatus;
    });
  }, [query, roleFilter, statusFilter]);

  const stats = useMemo(() => {
    const total = MOCK_USERS.length;
    const admins = MOCK_USERS.filter((u) => u.role === "admin").length;
    const suspended = MOCK_USERS.filter((u) => u.status === "suspended").length;
    const creators = MOCK_USERS.filter((u) => u.role === "creator").length;
    return { total, admins, suspended, creators };
  }, []);

  return (
    <Box component="section" py="xl" px={{ base: "md", md: "xl" }}>
      <Stack gap="xl">
        <Stack gap={4}>
          <Title order={2}>User management</Title>
          <Text c="dimmed">
            Monitor CMS accounts, roles, and publishing access. Use the filters below to locate accounts across locations, tags, and
            roles defined in the Drizzle schema.
          </Text>
        </Stack>

        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="lg">
          <StatCard label="Total accounts" value={stats.total} highlight="+4 new this week" />
          <StatCard label="Administrators" value={stats.admins} highlight="Full access" />
          <StatCard label="Creators" value={stats.creators} highlight="Can publish media" />
          <StatCard label="Suspended" value={stats.suspended} highlight="Require review" color="red" />
        </SimpleGrid>

        <Card withBorder radius="lg" padding="lg">
          <Stack gap="lg">
            <Group justify="space-between" align="flex-start">
              <Stack gap={2}>
                <Title order={4}>Directory</Title>
                <Text size="sm" c="dimmed">
                  {filteredUsers.length} result{filteredUsers.length === 1 ? "" : "s"} · synced with `users` table
                </Text>
              </Stack>
              <Group gap="xs">
                <Button variant="default">Export CSV</Button>
                <Button>Add new user</Button>
              </Group>
            </Group>

            <Group gap="md" align="flex-end" wrap="wrap">
              <TextInput
                label="Search"
                placeholder="Name, email, tag..."
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                leftSection={<SearchIcon />}
                leftSectionPointerEvents="none"
                styles={{ input: { minWidth: "16rem" } }}
              />
              <Select
                label="Role"
                value={roleFilter}
                onChange={setRoleFilter}
                data={[
                  { label: "All roles", value: "all" },
                  ...Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label })),
                ]}
                styles={{ input: { minWidth: "12rem" } }}
              />
              <Select
                label="Status"
                value={statusFilter}
                onChange={setStatusFilter}
                data={[
                  { label: "All statuses", value: "all" },
                  { label: "Active", value: "active" },
                  { label: "Pending", value: "pending" },
                  { label: "Suspended", value: "suspended" },
                ]}
                styles={{ input: { minWidth: "12rem" } }}
              />
            </Group>

            <Divider />

            <ScrollArea>
              <Table striped highlightOnHover verticalSpacing="md">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w="20%">User</Table.Th>
                    <Table.Th>Role</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Tags</Table.Th>
                    <Table.Th>Media</Table.Th>
                    <Table.Th>Location</Table.Th>
                    <Table.Th>Last activity</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {filteredUsers.map((user) => (
                    <Table.Tr key={user.id}>
                      <Table.Td>
                        <Stack gap={0}>
                          <Text fw={600}>{user.username}</Text>
                          <Text size="sm" c="dimmed">
                            {user.email}
                          </Text>
                        </Stack>
                      </Table.Td>
                      <Table.Td>
                        <Badge color={ROLE_COLORS[user.role]} variant="light">
                          {ROLE_LABELS[user.role]}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Badge color={STATUS_COLORS[user.status]} variant="light">
                          {user.status}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={6}>
                          {user.tags.map((tag) => (
                            <Badge key={tag} variant="outline" color="gray" radius="sm">
                              {tag}
                            </Badge>
                          ))}
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Text fw={600}>{user.mediaCount}</Text>
                        <Text size="xs" c="dimmed">
                          items published
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text>{user.location ?? "—"}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text>{user.lastActivity}</Text>
                      </Table.Td>
                      <Table.Td>
                        <ActionIcon variant="subtle" aria-label={`Actions for ${user.username}`}>
                          <DotsIcon />
                        </ActionIcon>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                  {filteredUsers.length === 0 && (
                    <Table.Tr>
                      <Table.Td colSpan={8}>
                        <Stack align="center" py="xl" gap="xs">
                          <Text fw={600}>No users match the current filters</Text>
                          <Text size="sm" c="dimmed">
                            Adjust the role or status filter to continue.
                          </Text>
                        </Stack>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Stack>
        </Card>
      </Stack>
    </Box>
  );
}

type StatCardProps = {
  label: string;
  value: number;
  highlight: string;
  color?: string;
};

function StatCard({ label, value, highlight, color = "blue" }: StatCardProps) {
  return (
    <Paper withBorder radius="lg" p="lg">
      <Stack gap={6}>
        <Text size="sm" c="dimmed">
          {label}
        </Text>
        <Text fz={32} fw={700} c={color}>
          {value}
        </Text>
        <Text size="sm" c="dimmed">
          {highlight}
        </Text>
      </Stack>
    </Paper>
  );
}
