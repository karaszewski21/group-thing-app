import { describe, expect, it } from "vitest";
import { findPreset, PALETTE_PRESETS } from "../theme/palettePresets";
import { contrastFailures, contrastRatio, INK, INK_SOFT, PAPER } from "./themeContrast";

describe("PALETTE_PRESETS", () => {
  it("has exactly 9 unique keys in tile order and no MINT", () => {
    const keys = PALETTE_PRESETS.map((preset) => preset.key);
    expect(keys).toEqual([
      "OCEAN",
      "LAVENDER",
      "RASPBERRY",
      "SUN",
      "FOREST",
      "TERRACOTTA",
      "GRAPHITE",
      "PLUM",
      "NORTH_SEA",
    ]);
    expect(new Set(keys).size).toBe(9);
    expect(findPreset("MINT")).toBeUndefined();
    expect(findPreset("OCEAN")?.label).toBe("Ocean");
  });

  it.each(PALETTE_PRESETS.map((preset) => [preset.key, preset] as const))(
    "%s meets WCAG AA for every role pair, including the hand-tuned roles",
    (key, preset) => {
      const v = preset.vars;
      const extra: [fg: string, bg: string][] = [
        [INK, v["--color-cream"]],
        [INK, v["--color-primary-soft"]],
        [INK, v["--color-accent-soft"]],
        [v["--color-accent-fg"], v["--color-cream"]],
        [INK_SOFT, PAPER],
      ];
      const failures = [
        ...contrastFailures(v, key),
        ...extra.filter(([fg, bg]) => contrastRatio(fg, bg) < 4.5).map(([fg, bg]) => `${key}: ${fg} on ${bg} < 4.5`),
      ];
      expect(failures).toEqual([]);
      for (const value of Object.values(v)) {
        expect(value).toMatch(/^#[0-9a-f]{6}$/);
      }
    },
  );
});
