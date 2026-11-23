import { describe, expect, it } from "vitest";
import { appPages } from "./appRoutes";
import { PANEL_PAGES } from "./panelPages";

describe("panel page list for tests", () => {
  it("has every page under app/(public)/(panel), plus / for home", () => {
    const panel = appPages()
      .filter((page) => page.dir.startsWith("(public)/(panel)/"))
      .map((page) => page.pattern);
    expect(Object.keys(PANEL_PAGES).sort()).toEqual(["/", ...panel].sort());
  });

  it("has the wants pages and no /add/hunting", () => {
    const patterns = Object.keys(PANEL_PAGES);
    expect(patterns).toEqual(expect.arrayContaining(["/wanted", "/wanted/:id", "/wanted/:id/edit", "/add/wanted"]));
    expect(patterns).not.toContain("/add/hunting");
  });
});
