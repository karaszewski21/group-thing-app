import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RESERVED_SLUGS } from "../routing/reservedSlugs";
import { appPages } from "./appRoutes";

/** The double-quoted entries of the backend's `RESERVED_SLUGS = frozenset({...})` literal. */
function backendReservedSlugs(): string[] {
  const source = readFileSync(resolve(process.cwd(), "../backend/app/organizations/slugs.py"), "utf8");
  const literal = source.match(/RESERVED_SLUGS[^=]*=\s*frozenset\(\s*\{([\s\S]*?)\}\s*\)/);
  expect(literal, "RESERVED_SLUGS literal not found in slugs.py").not.toBeNull();
  return Array.from(literal![1].matchAll(/"([^"]*)"/g), (match) => match[1]);
}

describe("reserved slugs", () => {
  it("lists every top-level static segment of the route tree", () => {
    const topLevel = new Set(
      appPages()
        .map((page) => page.pattern.split("/")[1])
        .filter((segment) => segment !== "" && !segment.startsWith(":")),
    );
    expect([...topLevel].sort()).toEqual([...RESERVED_SLUGS].sort());
  });

  it("is reserved by the backend too", () => {
    const backend = backendReservedSlugs();
    expect(backend).toContain("home");
    for (const slug of RESERVED_SLUGS) expect(backend, slug).toContain(slug);
  });
});
