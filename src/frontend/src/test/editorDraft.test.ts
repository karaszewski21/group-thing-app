import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME,
  diffDraft,
  paletteSelection,
  sameDraft,
  toDraft,
  type Draft,
  type DraftChanges,
} from "../features/editor/draft";

const BASELINE: Draft = {
  name: "Muzyczne Skrzaty",
  about: "Śpiewamy razem.",
  pageLayout: "CLASSIC",
  theme: { palette_preset: null, primary_color: "#7A2A4F", accent_color: null },
};

describe("editor draft", () => {
  it("turns a stored page into a draft, an empty description into an empty text", () => {
    expect(
      toDraft({
        name: "Ania",
        about: null,
        pageLayout: "BANNER",
        palette_preset: "OCEAN",
        primary_color: "#0E7490",
        accent_color: "#F59E0B",
      }),
    ).toEqual({
      name: "Ania",
      about: "",
      pageLayout: "BANNER",
      theme: { palette_preset: "OCEAN", primary_color: "#0E7490", accent_color: "#F59E0B" },
    });
  });

  it.each<{ name: string; current: Draft; expected: DraftChanges }>([
    { name: "nothing changed", current: BASELINE, expected: {} },
    { name: "a renamed page, trimmed", current: { ...BASELINE, name: "  Skrzaty " }, expected: { name: "Skrzaty" } },
    { name: "whitespace around the name only", current: { ...BASELINE, name: " Muzyczne Skrzaty\n" }, expected: {} },
    {
      name: "a new description, trimmed",
      current: { ...BASELINE, about: " Tańczymy. " },
      expected: { about: "Tańczymy." },
    },
    { name: "a cleared description as null", current: { ...BASELINE, about: "   " }, expected: { about: null } },
    { name: "whitespace around the description only", current: { ...BASELINE, about: "Śpiewamy razem. \n" }, expected: {} },
    { name: "another layout", current: { ...BASELINE, pageLayout: "LINKS" }, expected: { page_layout: "LINKS" } },
    {
      name: "a case-only color change",
      current: { ...BASELINE, theme: { ...BASELINE.theme, primary_color: "#7a2a4f" } },
      expected: {},
    },
    {
      name: "a cleared color as an explicit null",
      current: { ...BASELINE, theme: { ...BASELINE.theme, primary_color: null } },
      expected: { primary_color: null },
    },
    {
      name: "a preset with its colors",
      current: { ...BASELINE, theme: { palette_preset: "OCEAN", primary_color: "#0E7490", accent_color: "#F59E0B" } },
      expected: { palette_preset: "OCEAN", primary_color: "#0E7490", accent_color: "#F59E0B" },
    },
    {
      name: "everything at once",
      current: { name: "Skrzaty", about: "", pageLayout: "SCHEDULE", theme: DEFAULT_THEME },
      expected: { name: "Skrzaty", about: null, page_layout: "SCHEDULE", primary_color: null },
    },
  ])("diffs $name", ({ current, expected }) => {
    expect(diffDraft(current, BASELINE)).toEqual(expected);
    expect(sameDraft(current, BASELINE)).toBe(Object.keys(expected).length === 0);
  });

  it.each<{ theme: Draft["theme"]; expected: string }>([
    { theme: DEFAULT_THEME, expected: "DEFAULT" },
    { theme: { palette_preset: "OCEAN", primary_color: "#0E7490", accent_color: null }, expected: "OCEAN" },
    { theme: BASELINE.theme, expected: "CUSTOM" },
    { theme: { palette_preset: "RETIRED", primary_color: null, accent_color: null }, expected: "CUSTOM" },
  ])("selects the $expected palette tile", ({ theme, expected }) => {
    expect(paletteSelection(theme)).toBe(expected);
  });
});
