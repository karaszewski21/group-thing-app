import { defineConfig } from "vite";

/** The plugin SDK as one IIFE script, served by Next from public/ at
 * /assets/plugin-sdk.js (git-ignored, rebuilt before dev and build). */
export default defineConfig({
  publicDir: false,
  build: {
    lib: {
      entry: "src/plugin-sdk/index.ts",
      name: "PluginSDK",
      formats: ["iife"],
      fileName: () => "plugin-sdk.js",
    },
    outDir: "public/assets",
    emptyOutDir: false,
  },
});
