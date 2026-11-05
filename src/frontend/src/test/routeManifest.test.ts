import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { authPath } from "../auth/authPaths";
import { INBOX_PATH, threadPath } from "../routing/messagesPaths";
import {
  eventEditPath,
  eventPath,
  familyMemberEditPath,
  groupDetailsPath,
  groupEditPath,
  ownerPagePath,
  placeEditPath,
  termAttendeesPath,
  termEditPath,
  viewPath,
  type View,
} from "../routing/paths";
import { APP_DIR, appPages, pageFor } from "./appRoutes";

const PANEL = [
  "/home",
  "/meetings",
  "/groups",
  "/groups/new",
  "/items",
  "/items/:id/edit",
  "/profile",
  "/settings",
  "/places",
  "/places/new",
  "/family",
  "/family/new",
  "/family/edit",
  "/family/members/new",
  "/account",
  "/search",
  "/wanted",
  "/add",
  "/add/product",
  "/add/term",
  "/add/event",
  "/add/hunting",
  "/groups/:groupId/edit",
  "/places/:locationId/edit",
  "/family/members/:familyMembershipId/edit",
  "/events/:eventId/edit",
  "/terms/:termId/edit",
  "/groups/:groupId",
  "/terms/:termId",
  "/messages",
  "/messages/:conversationId",
  "/organization",
  "/organization/appearance",
];

const ADMIN = [
  "/admin",
  "/admin/products",
  "/admin/products/new",
  "/admin/products/:id",
  "/admin/products/:id/edit",
  "/admin/categories",
  "/admin/categories/new",
  "/admin/categories/:id/edit",
  "/admin/groups",
  "/admin/terms",
  "/admin/photos",
  "/admin/plugins",
  "/admin/plugins/new",
  "/admin/plugins/:pluginId/detail",
  "/admin/plugins/:pluginId/edit",
  "/admin/plugins/:pluginId/*",
];

const INVENTORY = [
  "/",
  "/login",
  ...PANEL,
  "/:slug",
  "/:slug/items",
  "/:slug/meetings",
  "/:slug/terms",
  "/:slug/product",
  "/:slug/product/:id",
  "/:slug/event/:eventId",
  "/:slug/group/:groupId/term/:termId",
  "/oauth2/authorize",
  ...ADMIN,
];

const PARTY_ID = "0b6c4a8e-1f2d-4c3b-9a7e-5d6f8a9b0c1d";

describe("App Router route manifest", () => {
  it("has exactly the inventoried page patterns", () => {
    const patterns = appPages().map((page) => page.pattern);
    expect(patterns).toHaveLength(INVENTORY.length);
    expect([...patterns].sort()).toEqual([...INVENTORY].sort());
  });

  it("renders every panel section through the panel layout", () => {
    const panelPatterns = appPages()
      .filter((page) => page.dir.startsWith("(site)/(panel)/"))
      .map((page) => page.pattern);
    expect(panelPatterns.sort()).toEqual([...PANEL].sort());
  });

  it("serves every path helper's URL from a page", () => {
    const views = (
      [
        "home",
        "meetings",
        "groups",
        "groups/new",
        "items",
        "profile",
        "settings",
        "places",
        "places/new",
        "family",
        "family/new",
        "family/edit",
        "family/members/new",
        "account",
        "search",
        "wanted",
        "add",
        "add/product",
        "add/term",
        "add/event",
        "add/hunting",
        "messages",
        "organization",
      ] satisfies View[]
    ).map(viewPath);
    const urls = [
      ...views,
      groupEditPath("g-1"),
      placeEditPath("l-1"),
      familyMemberEditPath("fm-1"),
      eventEditPath("ev-1"),
      termEditPath("t-1"),
      groupDetailsPath("g-1"),
      termAttendeesPath("t-1"),
      ownerPagePath({ slug: "zielony-krag", party_id: PARTY_ID }),
      ownerPagePath({ slug: null, party_id: PARTY_ID }),
      eventPath("zielony-krag", "ev-1"),
      INBOX_PATH,
      threadPath("c-1"),
      authPath("login").split("?")[0],
    ];
    for (const url of urls) expect(pageFor(url), url).not.toBeNull();
  });

  it("never puts a server redirect() page under a layout that withholds its children", () => {
    // Such a layout renders nothing (or something else) on the server, so the
    // redirect would only run in the browser and the response would be a 200.
    const withholding = /\b(ClientOnly|AuthGuard|PanelGate)\b/;
    const redirectPages = appPages().filter((page) =>
      readFileSync(resolve(APP_DIR, page.dir, "page.tsx"), "utf8").includes("redirect("),
    );
    expect(redirectPages.map((page) => page.pattern).sort()).toEqual(
      ["/:slug/product", "/admin"].sort(),
    );
    for (const page of redirectPages) {
      const source = readFileSync(resolve(APP_DIR, page.dir, "page.tsx"), "utf8");
      expect(source, page.dir).not.toMatch(/^["']use client["']/);
      const segments = page.dir.split("/");
      for (let depth = 0; depth <= segments.length; depth++) {
        const layout = resolve(APP_DIR, ...segments.slice(0, depth), "layout.tsx");
        if (!existsSync(layout)) continue;
        expect(readFileSync(layout, "utf8"), `${layout} above ${page.dir}`).not.toMatch(withholding);
      }
    }
  });
});
