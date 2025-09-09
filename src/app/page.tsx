"use client";

import { Anchor, Button, Code, Container, Group, rem, Stack, Text, Image as MantineImage, Divider } from "@mantine/core";

export default function Home() {
  return (
    <Container size="lg" py="xl" mih="100vh">
      <Stack gap="xl" align="center" justify="center" style={{ minHeight: `calc(100vh - ${rem(40)})` }}>
        <MantineImage src="/next.svg" alt="Next.js logo" w={180} h={38} fit="contain" />

        <Stack gap="xs" align="center">
          <Text size="sm">
            Get started by editing <Code>src/app/page.tsx</Code>.
          </Text>
          <Text size="sm">Save and see your changes instantly.</Text>
        </Stack>

        <Group gap="md" wrap="wrap" justify="center">
          <Button
            component="a"
            href="https://vercel.com/new?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
            target="_blank"
            rel="noopener noreferrer"
            leftSection={<MantineImage src="/vercel.svg" alt="Vercel" w={16} h={16} fit="contain" />}
          >
            Deploy now
          </Button>
          <Button
            variant="default"
            component="a"
            href="https://nextjs.org/docs?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
            target="_blank"
            rel="noopener noreferrer"
          >
            Read our docs
          </Button>
        </Group>

        <Divider w="100%" my="md" />

        <Group gap="lg" wrap="wrap" justify="center">
          <Anchor
            href="https://nextjs.org/learn?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Group gap={6}>
              <MantineImage src="/file.svg" alt="File icon" w={16} h={16} />
              <Text>Learn</Text>
            </Group>
          </Anchor>

          <Anchor
            href="https://vercel.com/templates?framework=next.js&utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Group gap={6}>
              <MantineImage src="/window.svg" alt="Window icon" w={16} h={16} />
              <Text>Examples</Text>
            </Group>
          </Anchor>

          <Anchor
            href="https://nextjs.org?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Group gap={6}>
              <MantineImage src="/globe.svg" alt="Globe icon" w={16} h={16} />
              <Text>Go to nextjs.org →</Text>
            </Group>
          </Anchor>
        </Group>
      </Stack>
    </Container>
  );
}
