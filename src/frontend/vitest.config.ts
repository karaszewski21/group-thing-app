import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "next/navigation": fileURLToPath(new URL("./src/test/navigationMock.ts", import.meta.url)),
      "next/link": fileURLToPath(new URL("./src/test/nextLinkMock.tsx", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
