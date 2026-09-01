import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/plugin-sdk/index.ts",
      name: "PluginSDK",
      formats: ["iife"],
      fileName: () => "assets/plugin-sdk.js",
    },
    outDir: "../resources/static",
    emptyOutDir: false,
  },
});
