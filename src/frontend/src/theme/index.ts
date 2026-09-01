import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

const config = defineConfig({
  globalCss: {
    body: {
      bg: "#FAFAF9",
      fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      color: "#0F172A",
    },
  },
  theme: {
    tokens: {
      colors: {
        brand: {
          50: { value: "#EFF6FF" },
          100: { value: "#DBEAFE" },
          200: { value: "#BFDBFE" },
          300: { value: "#93C5FD" },
          400: { value: "#60A5FA" },
          500: { value: "#3B82F6" },
          600: { value: "#2563EB" },
          700: { value: "#1D4ED8" },
          800: { value: "#1E293B" },
          900: { value: "#0F172A" },
        },
        accent: {
          50: { value: "#FFFBEB" },
          100: { value: "#FEF3C7" },
          200: { value: "#FDE68A" },
          300: { value: "#FCD34D" },
          400: { value: "#FBBF24" },
          500: { value: "#F59E0B" },
          600: { value: "#D97706" },
          700: { value: "#B45309" },
          800: { value: "#92400E" },
          900: { value: "#78350F" },
        },
      },
    },
    semanticTokens: {
      colors: {
        scope1: {
          bg: { value: "{colors.amber.100}" },
          fg: { value: "{colors.amber.800}" },
        },
        scope2: {
          bg: { value: "{colors.blue.100}" },
          fg: { value: "{colors.blue.800}" },
        },
        scope3: {
          bg: { value: "{colors.indigo.100}" },
          fg: { value: "{colors.indigo.800}" },
        },
        scopeMixed: {
          bg: { value: "{colors.gray.100}" },
          fg: { value: "{colors.gray.800}" },
        },
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);
