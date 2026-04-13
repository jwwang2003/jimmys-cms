"use client";

import { PropsWithChildren, useState } from "react";
import { CacheProvider } from "@emotion/react";
import createCache from "@emotion/cache";
import { MantineProvider, createTheme } from "@mantine/core";
import { useServerInsertedHTML } from "next/navigation";

const cmsTheme = createTheme({
  primaryColor: "gray",
  defaultRadius: "md",
  fontFamily: "var(--font-geist-sans), sans-serif",
  fontFamilyMonospace: "var(--font-geist-mono), monospace",
  spacing: {
    xs: "0.5rem",
    sm: "0.75rem",
    md: "1rem",
    lg: "1.25rem",
    xl: "1.75rem",
  },
  components: {
    Button: {
      defaultProps: {
        size: "xs",
      },
    },
    TextInput: {
      defaultProps: {
        size: "xs",
      },
    },
    Textarea: {
      defaultProps: {
        size: "xs",
        autosize: true,
        minRows: 3,
      },
    },
    Select: {
      defaultProps: {
        size: "xs",
      },
    },
    Badge: {
      defaultProps: {
        size: "sm",
        radius: "xl",
      },
    },
  },
});

export default function MantineRegistry({ children }: PropsWithChildren) {
  const [cache] = useState(() => {
    const cache = createCache({ key: "mantine", prepend: false });
    cache.compat = true;
    return cache;
  });

  useServerInsertedHTML(() => (
    <style
      data-emotion={`${cache.key} ${Object.keys(cache.inserted).join(" ")}`}
      dangerouslySetInnerHTML={{ __html: Object.values(cache.inserted).join("") }}
    />
  ));

  return (
    <CacheProvider value={cache}>
      <MantineProvider forceColorScheme="dark" theme={cmsTheme}>
        {children}
      </MantineProvider>
    </CacheProvider>
  );
}
