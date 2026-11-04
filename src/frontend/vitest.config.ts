import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "next/navigation": fileURLToPath(new URL("./src/test/navigationMock.ts", import.meta.url)),
      "next/link": fileURLToPath(new URL("./src/test/nextLinkMock.tsx", import.meta.url)),
      // Route files under test import `api/server.ts`; its guard is for the Next bundler.
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
