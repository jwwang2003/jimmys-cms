"use client";

import { useState } from "react";
import { Button, Center, Container, Paper, PasswordInput, Stack, TextInput } from "@mantine/core";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Invalid username or password");
        return;
      }

      const user = await res.json();
      // Handle successful login (e.g., redirect or show success message)
      console.log("Login successful", user);
    } catch (err) {
      console.error(err);
      setError("An error occurred during login");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Center mih="100vh">
      <Container size={420}>
        <Paper withBorder radius="md" p="lg" shadow="sm">
          <form onSubmit={onSubmit} autoComplete="on" method="post">
            <Stack>
              <TextInput
                placeholder="Username"
                aria-label="Username"
                id="username"
                name="username"
                value={username}
                onChange={(e) => setUsername(e.currentTarget.value)}
                required
                autoComplete="username"
                data-autofocus
              />

              <PasswordInput
                placeholder="Password"
                aria-label="Password"
                id="current-password"
                name="password"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                required
                autoComplete="current-password"
              />

              {error && <div style={{ color: "red" }}>{error}</div>}

              <Button type="submit" loading={loading} fullWidth>
                Log in
              </Button>
            </Stack>
          </form>
        </Paper>
      </Container>
    </Center>
  );
}
