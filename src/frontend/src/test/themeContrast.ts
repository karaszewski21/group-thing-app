import type { ThemeVars } from "../theme/orgPalette";

export const PAPER = "#ffffff";
export const INK = "#1e2e27";
export const INK_SOFT = "#5c7069";

function relativeLuminance(hex: string): number {
  const channel = (offset: number) => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Every WCAG target the palette promises: text pairs 4.5:1, focus ring 3:1. */
export function contrastFailures(v: ThemeVars, label: string): string[] {
  const targets: [fg: string, bg: string, min: number][] = [
    [v["--color-on-primary"], v["--color-primary"], 4.5],
    [v["--color-primary-fg"], v["--color-cream"], 4.5],
    [v["--color-primary-fg"], PAPER, 4.5],
    [v["--color-primary-fg"], v["--color-primary-soft"], 4.5],
    [INK_SOFT, v["--color-cream"], 4.5],
    [INK_SOFT, v["--color-primary-soft"], 4.5],
    [v["--color-accent-fg"], v["--color-accent-soft"], 4.5],
    [v["--color-focus-ring"], v["--color-cream"], 3],
    [v["--color-focus-ring"], PAPER, 3],
  ];
  return targets
    .filter(([fg, bg, min]) => contrastRatio(fg, bg) < min)
    .map(([fg, bg, min]) => `${label}: ${fg} on ${bg} < ${min}`);
}
