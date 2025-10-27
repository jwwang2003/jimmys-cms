"use client";

import { PropsWithChildren, useState } from "react";
import { CacheProvider } from "@emotion/react";
import createCache from "@emotion/cache";
import { MantineProvider } from "@mantine/core";
import { useServerInsertedHTML } from "next/navigation";

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
      <MantineProvider>{children}</MantineProvider>
    </CacheProvider>
  );
}
