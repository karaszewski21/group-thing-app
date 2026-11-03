"use client";

import { ChakraProvider } from "@chakra-ui/react";
import createCache from "@emotion/cache";
import { CacheProvider } from "@emotion/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useServerInsertedHTML } from "next/navigation";
import { useState, type ReactNode } from "react";
import { getQueryClient } from "../api/queryClient";
import { AuthProvider } from "../auth/AuthContext";
import type { InitialSession } from "../auth/session";
import { NavigationTracker } from "../routing/NavigationTracker";
import { system } from "../theme/system";

/** Collects the Emotion styles Chakra inserts while rendering on the server
 * and writes them into the streamed `<head>`, instead of Emotion's inline
 * `<style>` siblings, which the client does not render and so fails to hydrate. */
function EmotionRegistry({ children }: { children: ReactNode }) {
  const [registry] = useState(() => {
    const cache = createCache({ key: "css", prepend: true });
    cache.compat = true;
    const insert = cache.insert;
    let inserted: { name: string; isGlobal: boolean }[] = [];
    cache.insert = (...args) => {
      const [selector, serialized] = args;
      if (cache.inserted[serialized.name] === undefined) inserted.push({ name: serialized.name, isGlobal: !selector });
      return insert(...args);
    };
    const flush = () => {
      const flushed = inserted;
      inserted = [];
      return flushed;
    };
    return { cache, flush };
  });

  useServerInsertedHTML(() => {
    const inserted = registry.flush();
    if (inserted.length === 0) return null;
    const globals: { name: string; style: string }[] = [];
    let styles = "";
    let names = "";
    for (const { name, isGlobal } of inserted) {
      const style = registry.cache.inserted[name];
      if (typeof style !== "string") continue;
      if (isGlobal) {
        globals.push({ name, style });
      } else {
        styles += style;
        names += ` ${name}`;
      }
    }
    return (
      <>
        {globals.map(({ name, style }) => (
          <style key={name} data-emotion={`${registry.cache.key}-global ${name}`} dangerouslySetInnerHTML={{ __html: style }} />
        ))}
        {styles && <style data-emotion={`${registry.cache.key}${names}`} dangerouslySetInnerHTML={{ __html: styles }} />}
      </>
    );
  });

  return <CacheProvider value={registry.cache}>{children}</CacheProvider>;
}

export function Providers({ children, initialSession }: { children: ReactNode; initialSession: InitialSession | null }) {
  return (
    <QueryClientProvider client={getQueryClient()}>
      <EmotionRegistry>
        <ChakraProvider value={system}>
          <AuthProvider initialSession={initialSession}>
            <NavigationTracker />
            {children}
          </AuthProvider>
        </ChakraProvider>
      </EmotionRegistry>
    </QueryClientProvider>
  );
}
