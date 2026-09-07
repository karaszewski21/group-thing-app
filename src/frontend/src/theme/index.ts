import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

const config = defineConfig({
  globalCss: {
    body: {
      bg: "#f4f8f0",
      fontFamily: "'Karla', 'Segoe UI', system-ui, sans-serif",
      color: "#1e2e27",
    },
    "h1, h2, h3, h4, h5, h6": {
      fontFamily: "'Fraunces', Georgia, serif",
    },
  },
  theme: {
    tokens: {
      fonts: {
        heading: { value: "'Fraunces', Georgia, serif" },
        body: { value: "'Karla', 'Segoe UI', system-ui, sans-serif" },
      },
      colors: {
        // Mint — ported 1:1 from the Tailwind palette in index.css so the
        // Chakra-based admin dashboard matches the cream/mint pages.
        brand: {
          50: { value: "#eef8f4" },
          100: { value: "#d8f0e6" },
          200: { value: "#c0e6d7" },
          300: { value: "#9ed8c2" },
          400: { value: "#6fc4a5" },
          500: { value: "#3fb68f" },
          600: { value: "#1b8168" },
          700: { value: "#156a55" },
          800: { value: "#105343" },
          900: { value: "#0b3c31" },
        },
        // Lime — secondary accent, ported from --color-lime / --color-lime-soft.
        accent: {
          50: { value: "#f5f9e6" },
          100: { value: "#eaf2ce" },
          200: { value: "#dbe8a8" },
          300: { value: "#c8dc7a" },
          400: { value: "#b7d05e" },
          500: { value: "#a9c24f" },
          600: { value: "#8ea23e" },
          700: { value: "#758632" },
          800: { value: "#5c6a28" },
          900: { value: "#44501e" },
        },
        // Teal — ported from --color-teal / --color-teal-soft, used for scope2.
        teal: {
          50: { value: "#eef8f8" },
          100: { value: "#d9ecec" },
          200: { value: "#c0e0e0" },
          300: { value: "#9ed0d0" },
          400: { value: "#87c4c4" },
          500: { value: "#6fb6b8" },
          600: { value: "#5a9d9f" },
          700: { value: "#478183" },
          800: { value: "#356364" },
          900: { value: "#244647" },
        },
        // Sage — ported from --color-sage / --color-sage-soft, used for scope3.
        sage: {
          50: { value: "#f1f6f0" },
          100: { value: "#dfebdc" },
          200: { value: "#c7ddc2" },
          300: { value: "#aecfa7" },
          400: { value: "#86b280" },
          500: { value: "#5d8a63" },
          600: { value: "#4c7350" },
          700: { value: "#3c5c40" },
          800: { value: "#2d4630" },
          900: { value: "#1f3122" },
        },
        ink: {
          50: { value: "#f4f8f0" },
          soft: { value: "#5c7069" },
          DEFAULT: { value: "#1e2e27" },
        },
      },
    },
    semanticTokens: {
      colors: {
        // Required so `colorPalette="brand"` / `"accent"` resolve on Chakra's
        // built-in recipes (Button, Spinner, etc.) — without these, Chakra
        // falls back to its default gray palette instead of our colors.
        brand: {
          contrast: { value: "white" },
          fg: { value: "{colors.brand.700}" },
          muted: { value: "{colors.brand.100}" },
          subtle: { value: "{colors.brand.50}" },
          emphasized: { value: "{colors.brand.200}" },
          solid: { value: "{colors.brand.600}" },
          focusRing: { value: "{colors.brand.500}" },
        },
        accent: {
          contrast: { value: "{colors.accent.900}" },
          fg: { value: "{colors.accent.800}" },
          muted: { value: "{colors.accent.100}" },
          subtle: { value: "{colors.accent.50}" },
          emphasized: { value: "{colors.accent.200}" },
          solid: { value: "{colors.accent.500}" },
          focusRing: { value: "{colors.accent.600}" },
        },
        scope1: {
          bg: { value: "{colors.accent.100}" },
          fg: { value: "{colors.accent.800}" },
        },
        scope2: {
          bg: { value: "{colors.teal.100}" },
          fg: { value: "{colors.teal.800}" },
        },
        scope3: {
          bg: { value: "{colors.sage.100}" },
          fg: { value: "{colors.sage.800}" },
        },
        scopeMixed: {
          bg: { value: "{colors.gray.100}" },
          fg: { value: "{colors.gray.700}" },
        },
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);
