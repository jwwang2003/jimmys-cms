"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Box,
  Button,
  Center,
  Container,
  Group,
  Paper,
  PasswordInput,
  Progress,
  Stack,
  Tabs,
  Text,
  TextInput,
} from "@mantine/core";
import { IconCheck, IconX } from "@tabler/icons-react";

type FormMode = "login" | "register";

const AUTO_EMAIL_DOMAIN = "users.local";

function PasswordRequirement({ meets, label }: { meets: boolean; label: string }) {
  return (
    <Text component="div" c={meets ? "teal" : "red"} mt={5} size="sm">
      <Center inline>
        {meets ? <IconCheck size={14} stroke={1.5} /> : <IconX size={14} stroke={1.5} />}
        <Box ml={7}>{label}</Box>
      </Center>
    </Text>
  );
}

const requirements = [
  { re: /[0-9]/, label: "Includes number" },
  { re: /[a-z]/, label: "Includes lowercase letter" },
  { re: /[A-Z]/, label: "Includes uppercase letter" },
  { re: /[$&+,:;=?@#|'<>.^*()%!-_]/, label: "Includes special symbol" },
];

function getStrength(password: string) {
  let multiplier = password.length > 5 ? 0 : 1;

  requirements.forEach((requirement) => {
    if (!requirement.re.test(password)) {
      multiplier += 1;
    }
  });

  return Math.max(100 - (100 / (requirements.length + 1)) * multiplier, 0);
}

type PasswordStrengthInputProps = {
  value: string;
  onChange: (value: string) => void;
};

function PasswordStrengthInput({ value, onChange }: PasswordStrengthInputProps) {
  const strength = getStrength(value);
  const checks = requirements.map((requirement) => (
    <PasswordRequirement key={requirement.label} label={requirement.label} meets={requirement.re.test(value)} />
  ));
  const bars = Array(4)
    .fill(0)
    .map((_, index) => (
      <Progress
        styles={{ section: { transitionDuration: "0ms" } }}
        value={value.length > 0 && index === 0 ? 100 : strength >= ((index + 1) / 4) * 100 ? 100 : 0}
        color={strength > 80 ? "teal" : strength > 50 ? "yellow" : "red"}
        key={index}
        size={4}
      />
    ));

  return (
    <div>
      <PasswordInput
        placeholder="Create a password"
        aria-label="Password"
        id="password"
        name="password"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        required
        autoComplete="new-password"
      />

      <Group gap={5} grow mt="xs" mb="md">
        {bars}
      </Group>

      <PasswordRequirement label="Has at least 6 characters" meets={value.length > 5} />
      {checks}
    </div>
  );
}

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

                  {mode === "login" ? (
                    <PasswordInput
                      placeholder="Password"
                      aria-label="Password"
                      id="password"
                      name="password"
                      value={password}
                      onChange={(e) => setPassword(e.currentTarget.value)}
                      required
                      autoComplete="current-password"
                    />
                  ) : (
                    <PasswordStrengthInput value={password} onChange={setPassword} />
                  )}

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
