import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LAYOUT_REGISTRY } from "../features/organization-public/layouts/registry";
import { PROFILE_LAYOUT_REGISTRY } from "../features/profile-public/layouts/registry";
import { PALETTE_PRESETS } from "../theme/palettes";

const BACKEND_APP = resolve(process.cwd(), "../backend/app");

/** The double-quoted keys of the `NAME = frozenset({...})` literal in a backend module under `app/`. */
function backendKeys(file: string, name: string): string[] {
  const source = readFileSync(resolve(BACKEND_APP, file), "utf8");
  const literal = source.match(new RegExp(`${name}[^=]*=\\s*frozenset\\(\\s*\\{([\\s\\S]*?)\\}\\s*\\)`));
  expect(literal, `${name} literal not found in ${file}`).not.toBeNull();
  return Array.from(literal![1].matchAll(/"([^"]+)"/g), (match) => match[1]).sort();
}

describe("organizer FE/BE key parity", () => {
  it("layout registry and palette preset keys match the backend allowlists", () => {
    expect(Object.keys(LAYOUT_REGISTRY).sort()).toEqual(backendKeys("organizations/page_layouts.py", "PAGE_LAYOUT_KEYS"));
    expect(PALETTE_PRESETS.map((preset) => preset.key).sort()).toEqual(
      backendKeys("organizations/palettes.py", "PALETTE_PRESET_KEYS"),
    );
  });

  it("profile layout registry keys match the backend allowlist", () => {
    expect(Object.keys(PROFILE_LAYOUT_REGISTRY).sort()).toEqual(
      backendKeys("users/profile_layouts.py", "PROFILE_PAGE_LAYOUT_KEYS"),
    );
  });
});
