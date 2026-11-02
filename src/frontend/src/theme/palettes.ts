import type { ThemeVars } from "./orgPalette";

/** A ready-made organizer palette. Its base colors are
 * `vars["--color-primary"]` and `vars["--color-accent"]`. */
export interface PalettePreset {
  key: string;
  label: string;
  vars: ThemeVars;
}

/** Hand-tuned role maps, seeded from buildOrgThemeVars and then frozen, so a
 * generator change never restyles a saved preset. Keys must stay in sync with
 * PALETTE_PRESET_KEYS in src/backend/app/organizations/palettes.py. The
 * default "Mięta" is not a preset: it is the keyless DEFAULT_THEME_VARS. */
export const PALETTE_PRESETS: readonly PalettePreset[] = [
  {
    key: "OCEAN",
    label: "Ocean",
    vars: {
      "--color-primary": "#0e7490",
      "--color-on-primary": "#ffffff",
      "--color-primary-fg": "#0e7490",
      "--color-primary-soft": "#dbf3fc",
      "--color-focus-ring": "#0e7490",
      "--color-accent": "#f59e0b",
      "--color-accent-soft": "#ffe9d1",
      "--color-accent-fg": "#975f00",
      "--color-cream": "#eef8fc",
      "--color-stage": "#e8f1f5",
      "--color-stage-wide": "#e1edf2",
      "--color-line": "#dceaf0",
      "--color-line-strong": "#c2d9e3",
    },
  },
  {
    key: "LAVENDER",
    label: "Lawenda",
    vars: {
      "--color-primary": "#6d5bd0",
      "--color-on-primary": "#ffffff",
      "--color-primary-fg": "#5a48b8",
      "--color-primary-soft": "#edecff",
      "--color-focus-ring": "#6d5bd0",
      "--color-accent": "#e9a6c8",
      "--color-accent-soft": "#fee5f1",
      "--color-accent-fg": "#945878",
      "--color-cream": "#f5f5fe",
      "--color-stage": "#efeef7",
      "--color-stage-wide": "#eaeaf4",
      "--color-line": "#e6e6f2",
      "--color-line-strong": "#d3d2e8",
    },
  },
  {
    key: "RASPBERRY",
    label: "Malina",
    vars: {
      "--color-primary": "#be185d",
      "--color-on-primary": "#ffffff",
      "--color-primary-fg": "#be185d",
      "--color-primary-soft": "#ffe8ec",
      "--color-focus-ring": "#be185d",
      "--color-accent": "#f4a261",
      "--color-accent-soft": "#ffe8d8",
      "--color-accent-fg": "#a35705",
      "--color-cream": "#fef3f5",
      "--color-stage": "#f6edee",
      "--color-stage-wide": "#f4e7ea",
      "--color-line": "#f2e3e6",
      "--color-line-strong": "#e7cdd2",
    },
  },
  {
    key: "SUN",
    label: "Słońce",
    vars: {
      "--color-primary": "#f2b705",
      "--color-on-primary": "#1e2e27",
      "--color-primary-fg": "#8a6700",
      "--color-primary-soft": "#fbedd1",
      "--color-focus-ring": "#b58800",
      "--color-accent": "#e85d04",
      "--color-accent-soft": "#ffe8de",
      "--color-accent-fg": "#b84800",
      "--color-cream": "#faf6ee",
      "--color-stage": "#f3efe7",
      "--color-stage-wide": "#efeae1",
      "--color-line": "#ece7db",
      "--color-line-strong": "#ded4bf",
    },
  },
  {
    key: "FOREST",
    label: "Las",
    vars: {
      "--color-primary": "#2f6b3a",
      "--color-on-primary": "#ffffff",
      "--color-primary-fg": "#2f6b3a",
      "--color-primary-soft": "#e2f4e3",
      "--color-focus-ring": "#2f6b3a",
      "--color-accent": "#c9a227",
      "--color-accent-soft": "#faecc9",
      "--color-accent-fg": "#856800",
      "--color-cream": "#f1f9f2",
      "--color-stage": "#ebf2eb",
      "--color-stage-wide": "#e5eee6",
      "--color-line": "#e0ebe1",
      "--color-line-strong": "#c8dbca",
    },
  },
  {
    key: "TERRACOTTA",
    label: "Terakota",
    vars: {
      "--color-primary": "#c2562f",
      "--color-on-primary": "#ffffff",
      "--color-primary-fg": "#b54b23",
      "--color-primary-soft": "#ffe9e2",
      "--color-focus-ring": "#c2562f",
      "--color-accent": "#e9c46a",
      "--color-accent-soft": "#f9eccf",
      "--color-accent-fg": "#876700",
      "--color-cream": "#fef4f0",
      "--color-stage": "#f7edea",
      "--color-stage-wide": "#f4e8e4",
      "--color-line": "#f2e4df",
      "--color-line-strong": "#e7cfc6",
    },
  },
  {
    key: "GRAPHITE",
    label: "Grafit",
    vars: {
      "--color-primary": "#3f4a54",
      "--color-on-primary": "#ffffff",
      "--color-primary-fg": "#3f4a54",
      "--color-primary-soft": "#ebeff3",
      "--color-focus-ring": "#3f4a54",
      "--color-accent": "#8ab4c9",
      "--color-accent-soft": "#e1f0f8",
      "--color-accent-fg": "#497185",
      "--color-cream": "#f3f7fb",
      "--color-stage": "#ecf0f4",
      "--color-stage-wide": "#e7ebef",
      "--color-line": "#e4e8eb",
      "--color-line-strong": "#d1d5d9",
    },
  },
  {
    key: "PLUM",
    label: "Śliwka",
    vars: {
      "--color-primary": "#7a2a4f",
      "--color-on-primary": "#ffffff",
      "--color-primary-fg": "#7a2a4f",
      "--color-primary-soft": "#ffe7ef",
      "--color-focus-ring": "#7a2a4f",
      "--color-accent": "#e0a458",
      "--color-accent-soft": "#ffe9d1",
      "--color-accent-fg": "#965f00",
      "--color-cream": "#fef3f7",
      "--color-stage": "#f6edf0",
      "--color-stage-wide": "#f3e7eb",
      "--color-line": "#f1e3e8",
      "--color-line-strong": "#e6cdd6",
    },
  },
  {
    key: "NORTH_SEA",
    label: "Morze Północne",
    vars: {
      "--color-primary": "#1f4e79",
      "--color-on-primary": "#ffffff",
      "--color-primary-fg": "#1f4e79",
      "--color-primary-soft": "#e2f0ff",
      "--color-focus-ring": "#1f4e79",
      "--color-accent": "#7fb8c4",
      "--color-accent-soft": "#def1f6",
      "--color-accent-fg": "#3c7480",
      "--color-cream": "#f0f7fe",
      "--color-stage": "#eaf0f7",
      "--color-stage-wide": "#e4ecf4",
      "--color-line": "#dfe8f2",
      "--color-line-strong": "#c8d7e6",
    },
  },
];

export function findPreset(key: string | null | undefined): PalettePreset | undefined {
  return key ? PALETTE_PRESETS.find((preset) => preset.key === key) : undefined;
}
