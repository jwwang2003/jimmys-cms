"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  Container,
  Group,
  Paper,
  PasswordInput,
  Select,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
} from "@mantine/core";

type FormMode = "login" | "register";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<FormMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<string | null>("user");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(action: "login" | "register") {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action,
          username,
          password,
          role,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Authentication failed");
      }
      setMessage(action === "login" ? "Signed in. Redirecting..." : "Account created. Redirecting...");
      router.push("/admin");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  async function continueAsGuest() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/auth/guest", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Guest sign-in failed");
      }
      setMessage("Guest session ready. Redirecting...");
      router.push("/admin");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Guest sign-in failed");
    } finally {
      setLoading(false);
    }
  }

  const isRegister = mode === "register";

  return (
    <Container size={520} py="xl" mih="100vh" style={{ display: "grid", placeItems: "center" }}>
      <Paper withBorder radius="lg" p="xl" shadow="md" w="100%">
        <Stack gap="lg">
          <Stack gap={4}>
            <Title order={2}>CMS Login</Title>
            <Text c="dimmed">
              Sign in as an admin or user, register a new account, or create a passwordless guest session.
            </Text>
          </Stack>

          <Tabs value={mode} onChange={(value) => setMode((value as FormMode) || "login")}>
            <Tabs.List grow>
              <Tabs.Tab value="login">Sign in</Tabs.Tab>
              <Tabs.Tab value="register">Register</Tabs.Tab>
            </Tabs.List>
          </Tabs>

          <Stack gap="sm">
            <TextInput
              label="Username"
              placeholder="your-handle"
              value={username}
              onChange={(event) => setUsername(event.currentTarget.value)}
            />

            {isRegister && (
              <Select
                label="Role"
                value={role}
                onChange={setRole}
                data={[
                  { value: "user", label: "User (password required)" },
                  { value: "guest", label: "Guest (password optional)" },
                ]}
              />
            )}

            <PasswordInput
              label={isRegister && role === "guest" ? "Password (optional)" : "Password"}
              placeholder={isRegister && role === "guest" ? "Leave blank for passwordless guest access" : "Password"}
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
            />

            {error && <Alert color="red" variant="light">{error}</Alert>}
            {message && <Alert color="green" variant="light">{message}</Alert>}

            <Group grow>
              <Button loading={loading} onClick={() => submit(isRegister ? "register" : "login")}>
                {isRegister ? "Create account" : "Sign in"}
              </Button>
              <Button variant="default" loading={loading} onClick={continueAsGuest}>
                Continue as guest
              </Button>
            </Group>

            <Text size="sm" c="dimmed">
              Admin access is bootstrapped automatically from `ADMIN_USERNAME` and `ADMIN_PASSWORD`. Guests can be passwordless or
              password-protected.
            </Text>
          </Stack>
        </Stack>
      </Paper>
    </Container>
  );
}
