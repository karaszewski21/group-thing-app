import type { OrganizerTheme } from "../api/groups";

/** The 13 themable color roles, in index.css token order. */
export const THEME_ROLES = [
  "primary",
  "on-primary",
  "primary-fg",
  "primary-soft",
  "focus-ring",
  "accent",
  "accent-soft",
  "accent-fg",
  "cream",
  "stage",
  "stage-wide",
  "line",
  "line-strong",
] as const;

export type ThemeRole = (typeof THEME_ROLES)[number];

/** Inline custom properties for one theme; every value is a lowercase `#rrggbb`. */
export type ThemeVars = Record<`--color-${ThemeRole}`, string>;

/** Hand-tuned defaults, equal to the index.css values. Not generator output:
 * the generator would tint `cream` differently. */
export const DEFAULT_THEME_VARS: ThemeVars = {
  "--color-primary": "#1b8168",
  "--color-on-primary": "#ffffff",
  "--color-primary-fg": "#117b63",
  "--color-primary-soft": "#dcf5ec",
  "--color-focus-ring": "#1b8168",
  "--color-accent": "#a9c24f",
  "--color-accent-soft": "#eaf2ce",
  "--color-accent-fg": "#56701f",
  "--color-cream": "#f4f8f0",
  "--color-stage": "#edf1ea",
  "--color-stage-wide": "#e7ede4",
  "--color-line": "#e2eadf",
  "--color-line-strong": "#cbdac7",
};

const INK = "#1e2e27";
const WHITE = "#ffffff";
const PAPER = "#ffffff";
const INK_SOFT = "#5c7069";
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

type Oklch = [l: number, c: number, h: number];

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function hexToLinear(hex: string): number[] {
  return [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
}

function hexToOklch(hex: string): Oklch {
  const [r, g, b] = hexToLinear(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(a, bb), ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360];
}

function oklchToLinear(L: number, C: number, H: number): number[] {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb: number[]) => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);

/** OKLCH → hex, keeping L and H and bisecting C down until the color fits sRGB. */
function oklchToHex(L: number, C: number, H: number): string {
  const lightness = Math.min(1, Math.max(0, L));
  let chroma = C;
  if (!inGamut(oklchToLinear(lightness, chroma, H))) {
    let lo = 0;
    let hi = chroma;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear(lightness, mid, H))) lo = mid;
      else hi = mid;
    }
    chroma = lo;
  }
  return (
    "#" +
    oklchToLinear(lightness, chroma, H)
      .map((c) =>
        Math.round(Math.min(1, Math.max(0, fromLinear(c))) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

/** WCAG 2 contrast ratio — the same formula as themeDefects.test.tsx. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, b2] = hexToLinear(hex);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The seed when it already passes; otherwise the lightest L in [0, L] that
 * passes. Checked on the rounded hex, so the result is exactly what ships. */
function darkenUntil(L: number, C: number, H: number, passes: (hex: string) => boolean): string {
  const seed = oklchToHex(L, C, H);
  if (passes(seed)) return seed;
  let lo = 0;
  let hi = L;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (passes(oklchToHex(mid, C, H))) lo = mid;
    else hi = mid;
  }
  return oklchToHex(lo, C, H);
}

/** Derives all 13 role colors from an organizer's primary (and optional
 * accent) so every text pair reaches 4.5:1 and the focus ring 3:1. */
export function buildOrgThemeVars(primary: string, accent?: string): ThemeVars {
  const [seedL, C, H] = hexToOklch(primary.toLowerCase());
  const L = seedL > 0.9 ? 0.75 : seedL;
  const seed = oklchToHex(L, C, H);

  let primaryColor: string;
  let onPrimary: string;
  if (contrast(seed, WHITE) >= 4.5) {
    primaryColor = seed;
    onPrimary = WHITE;
  } else if (L > 0.68 && contrast(seed, INK) >= 4.5) {
    primaryColor = seed;
    onPrimary = INK;
  } else {
    primaryColor = darkenUntil(L, C, H, (x) => contrast(x, WHITE) >= 4.5);
    onPrimary = WHITE;
  }

  const tint = (l: number, targetChroma: number) => oklchToHex(l, Math.min(targetChroma, C * 0.3), H);
  const cream = tint(0.974, 0.012);

  // Some hues (mostly magenta) need a slightly lighter soft fill for ink-soft text.
  const softChroma = Math.min(C * 0.3, 0.04);
  let softL = 0.95;
  let primarySoft = oklchToHex(softL, softChroma, H);
  while (contrast(INK_SOFT, primarySoft) < 4.5 && softL < 0.985) {
    softL += 0.005;
    primarySoft = oklchToHex(softL, softChroma, H);
  }

  const primaryFg = darkenUntil(
    L,
    C,
    H,
    (x) => contrast(x, cream) >= 4.5 && contrast(x, PAPER) >= 4.5 && contrast(x, primarySoft) >= 4.5,
  );
  const focusRing = darkenUntil(L, C, H, (x) => contrast(x, cream) >= 3 && contrast(x, PAPER) >= 3);

  const accentColor = accent ? accent.toLowerCase() : oklchToHex(0.77, Math.min(0.15, Math.max(0.1, C)), (H + 300) % 360);
  const [accentL, accentC, accentH] = hexToOklch(accentColor);
  const accentSoft = oklchToHex(0.946, Math.min(accentC * 0.35, 0.05), accentH);
  const accentFg = darkenUntil(accentL, accentC, accentH, (x) => contrast(x, accentSoft) >= 4.5);

  return {
    "--color-primary": primaryColor,
    "--color-on-primary": onPrimary,
    "--color-primary-fg": primaryFg,
    "--color-primary-soft": primarySoft,
    "--color-focus-ring": focusRing,
    "--color-accent": accentColor,
    "--color-accent-soft": accentSoft,
    "--color-accent-fg": accentFg,
    "--color-cream": cream,
    "--color-stage": tint(0.953, 0.011),
    "--color-stage-wide": tint(0.939, 0.014),
    "--color-line": tint(0.928, 0.017),
    "--color-line-strong": tint(0.872, 0.03),
  };
}

/** The organizer's generated palette when it has a valid primary color,
 * otherwise the defaults (no theme, accent-only, or malformed value). */
export function resolveOrgTheme(
  theme: Pick<OrganizerTheme, "primary_color" | "accent_color"> | null | undefined,
): ThemeVars {
  const primary = theme?.primary_color;
  if (!primary || !HEX_COLOR.test(primary)) return DEFAULT_THEME_VARS;
  const accent = theme.accent_color && HEX_COLOR.test(theme.accent_color) ? theme.accent_color : undefined;
  return buildOrgThemeVars(primary, accent);
}
