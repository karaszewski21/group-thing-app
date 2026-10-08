import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LAYOUT_REGISTRY } from "../pages/organizer/layouts/registry";
import { PALETTE_PRESETS } from "../theme/palettePresets";

const BACKEND_ORGANIZATIONS = resolve(process.cwd(), "../backend/app/organizations");

/** The double-quoted keys of the `NAME = frozenset({...})` literal in a backend module. */
function backendKeys(file: string, name: string): string[] {
  const source = readFileSync(resolve(BACKEND_ORGANIZATIONS, file), "utf8");
  const literal = source.match(new RegExp(`${name}[^=]*=\\s*frozenset\\(\\s*\\{([\\s\\S]*?)\\}\\s*\\)`));
  expect(literal, `${name} literal not found in ${file}`).not.toBeNull();
  return Array.from(literal![1].matchAll(/"([^"]+)"/g), (match) => match[1]).sort();
}

describe("organizer FE/BE key parity", () => {
  it("layout registry and palette preset keys match the backend allowlists", () => {
    expect(Object.keys(LAYOUT_REGISTRY).sort()).toEqual(backendKeys("page_layouts.py", "PAGE_LAYOUT_KEYS"));
    expect(PALETTE_PRESETS.map((preset) => preset.key).sort()).toEqual(
      backendKeys("palettes.py", "PALETTE_PRESET_KEYS"),
    );
  });
});
