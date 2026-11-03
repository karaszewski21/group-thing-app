import { describe, expect, it } from "vitest";
import { appPages } from "./appRoutes";
import { PANEL_PAGES } from "./panelPages";

describe("panel page list for tests", () => {
  it("has every page under app/(site)/(panel), plus / for home", () => {
    const panel = appPages()
      .filter((page) => page.dir.startsWith("(site)/(panel)/"))
      .map((page) => page.pattern);
    expect(Object.keys(PANEL_PAGES).sort()).toEqual(["/", ...panel].sort());
  });
});
