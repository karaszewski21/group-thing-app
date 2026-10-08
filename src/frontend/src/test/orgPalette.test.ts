import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildOrgThemeVars,
  DEFAULT_THEME_VARS,
  describeColorAdjustment,
  resolveOrgTheme,
  THEME_ROLES,
} from "../theme/orgPalette";
import { findPreset } from "../theme/palettePresets";
import { contrastFailures, INK } from "./themeContrast";

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const k = (n: number) => (n + hue / 30) % 12;
  const a = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n: number) => lightness - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return (
    "#" +
    [0, 8, 4].map((n) => Math.round(channel(n) * 255).toString(16).padStart(2, "0")).join("")
  );
}

function generatorFailures(primary: string, accent: string | undefined): string[] {
  return contrastFailures(buildOrgThemeVars(primary, accent), `${primary}/${accent ?? "-"}`);
}

const SEEDS: [primary: string, accent: string | undefined][] = [
  ["#1b8168", "#a9c24f"],
  ["#c0392b", undefined],
  ["#f1c40f", "#2c3e50"],
  ["#3498db", undefined],
  ["#8e44ad", "#f39c12"],
  ["#000000", undefined],
  ["#ffffff", undefined],
  ["#ff69b4", undefined],
  ["#3fb68f", undefined],
  ["#7a2a4f", undefined],
];

describe("buildOrgThemeVars", () => {
  it.each(SEEDS)("%s (accent %s) meets WCAG AA for every role pair", (primary, accent) => {
    expect(generatorFailures(primary, accent)).toEqual([]);
  });

  it("meets every contrast target across a deterministic hue/saturation/lightness sweep", () => {
    const failures: string[] = [];
    let seeds = 0;
    for (let hue = 0; hue < 360; hue += 30) {
      for (const saturation of [0, 0.25, 0.45, 0.65, 0.85, 1]) {
        for (const lightness of [0.08, 0.2, 0.32, 0.45, 0.58, 0.72, 0.86]) {
          const primary = hslToHex(hue, saturation, lightness);
          const accent = seeds % 2 === 0 ? undefined : hslToHex((hue + 150) % 360, saturation, 1 - lightness);
          failures.push(...generatorFailures(primary, accent));
          seeds++;
        }
      }
    }
    expect(seeds).toBe(504);
    expect(failures).toEqual([]);
  });

  it("gives identical output for uppercase and lowercase input", () => {
    expect(buildOrgThemeVars("#7A2A4F", "#A9C24F")).toEqual(buildOrgThemeVars("#7a2a4f", "#a9c24f"));
  });

  it("returns exactly the 13 role keys as lowercase hex", () => {
    const v = buildOrgThemeVars("#3498db");
    expect(Object.keys(v).sort()).toEqual(THEME_ROLES.map((role) => `--color-${role}`).sort());
    for (const value of Object.values(v)) {
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("clamps a white seed so primary is not white and labels it with ink", () => {
    const v = buildOrgThemeVars("#ffffff");
    expect(v["--color-primary"]).not.toBe("#ffffff");
    expect(v["--color-on-primary"]).toBe(INK);
  });
});

describe("DEFAULT_THEME_VARS", () => {
  it("equals the 13 defaults declared in index.css", () => {
    const css = readFileSync(resolve(process.cwd(), "src", "index.css"), "utf8");
    const declared: Record<string, string> = {};
    for (const match of css.matchAll(/--color-([a-z-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
      declared[`--color-${match[1]}`] = match[2];
    }
    const defaults = Object.fromEntries(THEME_ROLES.map((role) => [`--color-${role}`, declared[`--color-${role}`]]));
    expect(DEFAULT_THEME_VARS).toEqual(defaults);
  });
});

describe("resolveOrgTheme", () => {
  it.each([null, undefined])("returns the defaults for %s", (theme) => {
    expect(resolveOrgTheme(theme)).toEqual(DEFAULT_THEME_VARS);
  });

  it("returns the defaults for an accent-only theme", () => {
    expect(resolveOrgTheme({ primary_color: null, accent_color: "#f39c12" })).toEqual(DEFAULT_THEME_VARS);
  });

  it("returns the defaults for a malformed primary", () => {
    expect(resolveOrgTheme({ primary_color: "#7a2a4", accent_color: null })).toEqual(DEFAULT_THEME_VARS);
  });

  it("uses the generator for a valid primary and ignores an invalid accent", () => {
    expect(resolveOrgTheme({ primary_color: "#7A2A4F", accent_color: "lime" })).toEqual(buildOrgThemeVars("#7a2a4f"));
    expect(resolveOrgTheme({ primary_color: "#7a2a4f", accent_color: "#f39c12" })).toEqual(
      buildOrgThemeVars("#7a2a4f", "#f39c12"),
    );
  });

  it("returns the preset's hand-tuned vars for a known preset key", () => {
    expect(
      resolveOrgTheme({ palette_preset: "OCEAN", primary_color: "#0e7490", accent_color: "#f59e0b" }),
    ).toEqual(findPreset("OCEAN")?.vars);
  });

  it("falls back to the generator from the stored hex for an unknown preset key", () => {
    expect(resolveOrgTheme({ palette_preset: "RETIRED", primary_color: "#3498db", accent_color: null })).toEqual(
      buildOrgThemeVars("#3498db"),
    );
  });

  it("returns the defaults when preset and colors are all null", () => {
    expect(resolveOrgTheme({ palette_preset: null, primary_color: null, accent_color: null })).toBe(
      DEFAULT_THEME_VARS,
    );
  });
});

describe("describeColorAdjustment", () => {
  it.each([
    ["#3498db", { primaryDarkened: true, tooLight: false }],
    ["#ffffff", { primaryDarkened: true, tooLight: true }],
    ["#1b8168", { primaryDarkened: false, tooLight: false }],
  ])("describes %s", (primary, expected) => {
    expect(describeColorAdjustment(primary)).toEqual(expected);
  });
});
