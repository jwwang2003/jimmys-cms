"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  Center,
  Container,
  Paper,
  PasswordInput,
  Stack,
  Tabs,
  Text,
  TextInput,
} from "@mantine/core";

type FormMode = "login" | "register";

const AUTO_EMAIL_DOMAIN = "users.local";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<FormMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleModeChange = (value: string | null) => {
    if (!value) return;
    setMode(value as FormMode);
    setError(null);
    setSuccess(null);
    setPassword("");
    setConfirmPassword("");
  };

  async function handleLogin() {
    const trimmedUsername = username.trim();
    if (!trimmedUsername || !password.trim()) {
      setError("Please provide your username and password");
      return;
    }
    if (trimmedUsername.length < 3) {
      setError("Usernames must be at least 3 characters");
      return;
    }

    const res = await fetch("/api/auth/sign-in/username", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username: trimmedUsername, password }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.message || data?.error || "Invalid username or password");
    }
    setSuccess(`Welcome back, ${trimmedUsername}! Redirecting...`);
    router.push("/admin");
  }

  async function handleRegister() {
    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      setError("Choose a username to continue");
      return;
    }
    if (trimmedUsername.length < 3) {
      setError("Usernames must be at least 3 characters");
      return;
    }
    if (password.length < 6) {
      setError("Passwords must be at least 6 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    const fallbackEmail = `${trimmedUsername.toLowerCase()}@${AUTO_EMAIL_DOMAIN}`;
    const payload = {
      name: trimmedUsername,
      username: trimmedUsername,
      displayUsername: trimmedUsername,
      email: fallbackEmail,
      password,
    };

    const res = await fetch("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.message || data?.error || "Unable to create account");
    }

    setSuccess("Account created! Signing you in...");
    await handleLogin();
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      if (mode === "login") {
        await handleLogin();
      } else {
        await handleRegister();
      }
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Center mih="100vh">
      <Container size={480}>
        <Paper withBorder radius="md" p="xl" shadow="sm">
          <Tabs value={mode} onChange={handleModeChange} keepMounted={false}>
            <Tabs.List grow>
              <Tabs.Tab value="login">Sign in</Tabs.Tab>
              <Tabs.Tab value="register">Register</Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value={mode} pt="md">
              <form onSubmit={onSubmit} autoComplete="on" method="post">
                <Stack gap="md">
                  <div>
                    <Text size="sm" fw={600} mb={4}>
                      Username
                    </Text>
                    <TextInput
                      placeholder="your-handle"
                      aria-label="Username"
                      id="username"
                      name="username"
                      value={username}
                      onChange={(e) => setUsername(e.currentTarget.value)}
                      required
                      autoComplete="username"
                      data-autofocus
                    />
                    <Text size="xs" c="dimmed" mt={4}>
                      Usernames must be 3-32 characters and unique.
                    </Text>
                  </div>

                  <PasswordInput
                    placeholder={mode === "login" ? "Password" : "Create a password"}
                    aria-label="Password"
                    id="password"
                    name="password"
                    value={password}
                    onChange={(e) => setPassword(e.currentTarget.value)}
                    required
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                  />

                  {mode === "register" && (
                    <PasswordInput
                      placeholder="Confirm password"
                      aria-label="Confirm password"
                      id="confirm-password"
                      name="confirm-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.currentTarget.value)}
                      required
                      autoComplete="new-password"
                    />
                  )}

                  {error && (
                    <Alert color="red" variant="light">
                      {error}
                    </Alert>
                  )}
                  {success && (
                    <Alert color="green" variant="light">
                      {success}
                    </Alert>
                  )}

                  <Button type="submit" loading={loading} fullWidth>
                    {mode === "login" ? "Sign in" : "Create account"}
                  </Button>

                  {mode === "register" && (
                    <Text size="xs" c="dimmed" ta="center">
                      Better Auth requires an email internally – we generate {""}
                      <Text span fw={600}>
                        {username ? `${username.toLowerCase()}@${AUTO_EMAIL_DOMAIN}` : `username@${AUTO_EMAIL_DOMAIN}`}
                      </Text>{" "}
                      for you automatically.
                    </Text>
                  )}
                </Stack>
              </form>
            </Tabs.Panel>
          </Tabs>
        </Paper>
      </Container>
    </Center>
  );
}
