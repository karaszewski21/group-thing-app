// @vitest-environment node
import { ChakraProvider } from "@chakra-ui/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionFromToken } from "../auth/session";
import type { EventDetailResponse } from "../api/events";
import type { GroupAccessResponse } from "../api/groups";
import type { ItemActionsResponse } from "../api/itemActions";
import type { ItemDetailsResponse } from "../api/items";
import type { PartyProfileResponse } from "../api/ownerItems";
import type { UserProfileResponse } from "../api/people";
import BackPageLayout from "../app/(public)/layout";
import SearchPage from "../app/(public)/search/page";
import { AuthProvider } from "../auth/AuthContext";
import { PublicLayout } from "../components/layout/PublicLayout";
import { LoginPage } from "../features/auth/LoginPage";
import { appearanceRouteElement, itemRouteElement, ownerRouteElement } from "./itemRoute";
import { eventRouteElement } from "./eventRoute";
import { termRouteElement } from "./termRoute";
import { LandingPage } from "../features/landing/LandingPage";
import { EVENT_KEY } from "../hooks/useEvent";
import { ITEM_ACTIONS_KEY } from "../hooks/useItemActions";
import { ITEM_DETAILS_KEY } from "../hooks/useItemDetail";
import { MY_PROFILE_KEY } from "../hooks/useMyProfile";
import { OWNER_ITEMS_KEY } from "../hooks/useOwnerItems";
import { GROUP_ACCESS_KEY } from "../hooks/useTermAccess";
import { system } from "../theme/system";
import { makeItemLocation } from "./fixtures/locations";
import { createTestQueryClient } from "./queryClient";
import { routeElement } from "./renderWithRoute";

vi.mock("../api/server", () => ({
  getEventOnServer: async () => null,
  getPublicCircleOnServer: async () => null,
}));

const EVENT_ID = "ev-1";
const GROUP_ID = "5f0c2a7e-3b1d-4e6a-9c8f-0000000000a5";
const TERM_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0000000000c1";

const EVENT: EventDetailResponse = {
  id: EVENT_ID,
  name: "Piknik w parku",
  description: "Kocyki i lemoniada",
  starts_at: "2026-11-02T14:00:00",
  ends_at: "2026-11-02T18:00:00",
  location: null,
  created_at: "",
  updated_at: "",
  author_slug: "zielony-krag",
  banner_url: null,
  attendee_count: 0,
  is_author: false,
  author_display_name: "Fundacja Zielony Krąg",
  organization: null,
  participants: [],
  is_attending: false,
  has_ended: false,
  open_reservations: null,
};

const ACCESS: GroupAccessResponse = {
  group: {
    id: GROUP_ID,
    name: "Muzyczne Skrzaty",
    organizer_display_name: "Ania Kowalska",
    organizer_slug: "ania",
    organizer_party_id: null,
    visibility: "PUBLIC",
    layout_mode: "CIRCLE",
    organization: null,
    term: {
      id: TERM_ID,
      occurs_on: "2026-11-20T17:00:00",
      description: "Zajęcia w parku",
      needed_items: [],
      item_listings: [],
    },
    guardians: [],
  },
  access: {
    is_member: false,
    is_organizer: false,
    can_view_content: true,
    is_attending: false,
    is_active_attendee: false,
  },
};

const ITEM_ID = "it-1";
const ITEM_ADDRESS = "ul. Polna 12, 32-650 Kęty";

const ITEM: ItemDetailsResponse = {
  id: ITEM_ID,
  product_id: "p-1",
  name: "Wózek spacerowy",
  category_id: "c-1",
  category_name: "Wózki",
  condition: "GOOD",
  listing_status: "ACTIVE",
  description: null,
  photos: [],
  product_photo_url: null,
  is_owner: true,
  location_id: "loc-1",
  deleted_at: null,
  status: { code: "AVAILABLE", term_occurs_on: null, due_date: null, counterparty_label: null, personal_pickup: false },
};

const ITEM_ACTIONS: ItemActionsResponse = {
  mode: "GIFT",
  visibility: "PUBLIC",
  available: true,
  reservation: null,
  party_reservation: null,
  owner: { party_id: "party-1", display_name: "Ania Kowalska", slug: null, items_total: 1 },
  viewer: "OWN",
  location: makeItemLocation({ formatted_address: ITEM_ADDRESS }),
  contexts: [],
  personal_pickup_available: true,
};

const PARTY_ID = "0b6f3c1e-9a7d-4c2e-8f1a-2d3e4f5a6b7c";

const PARTY_PROFILE: PartyProfileResponse = {
  owner: { party_id: PARTY_ID, display_name: "Ania Kowalska", slug: null },
  organization: null,
  bio: "Oddaję ubranka po córce.",
  page_layout: "BANNER",
  palette_preset: null,
  primary_color: null,
  accent_color: null,
  logo: null,
  avatar: { url: "https://cdn.test/a.webp", thumb_url: "https://cdn.test/a-t.webp" },
  cover: { url: "https://cdn.test/c.webp", thumb_url: "https://cdn.test/c-t.webp" },
  gallery: [{ url: "https://cdn.test/g.webp", thumb_url: "https://cdn.test/g-t.webp" }],
  nearest: null,
  counts: { GIFT: 1, SWAP: 0 },
  recent_items: [],
  is_me: true,
};

const MY_PROFILE: UserProfileResponse = {
  id: "profile-1",
  party_id: PARTY_ID,
  account_user_id: "user-1",
  display_name: "Ania Kowalska",
  email: null,
  bio: "Oddaję ubranka po córce.",
  created_at: "",
  updated_at: "",
  is_organizer: false,
  page_layout: "BANNER",
  palette_preset: null,
  primary_color: null,
  accent_color: null,
  media: [],
};

/** An unsigned JWT-shaped token: the server render only decodes its claims. */
const SESSION = `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ sub: "ania@example.com", permissions: [], exp: 4_102_444_800 }))}.signature`;

/** The app's provider stack around one routed page, rendered as on the server. */
function renderOnServer(
  url: string,
  pattern: string,
  page: ReactElement,
  client: QueryClient = createTestQueryClient(),
  token: string | null = null,
): string {
  return renderToString(
    <QueryClientProvider client={client}>
      <ChakraProvider value={system}>
        <AuthProvider initialSession={sessionFromToken(token)}>
          {routeElement(page, { url, pattern })}
        </AuthProvider>
      </ChakraProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // A server render never fetches; any request reaching the network is a bug.
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("fetch during server render"))));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const ORGANIZER_ITEM_ROUTE = await itemRouteElement("/zielony-krag/product/it-1");
const ORGANIZATION_ROUTE = await ownerRouteElement("/zielony-krag");
const PROFILE_ROUTE = await ownerRouteElement(`/${PARTY_ID}`);
const ORGANIZATION_APPEARANCE_ROUTE = await appearanceRouteElement("/zielony-krag/appearance");
const PROFILE_APPEARANCE_ROUTE = await appearanceRouteElement(`/${PARTY_ID}/appearance`);
const EVENT_ROUTE = await eventRouteElement(`/zielony-krag/event/${EVENT_ID}`);
const TERM_ROUTE = await termRouteElement(`/ania/group/${GROUP_ID}/term/${TERM_ID}`);

describe("SSR safety", () => {
  it("renders the landing page inside PublicLayout and the login page without browser globals", () => {
    expect(typeof window).toBe("undefined");
    const landing = renderOnServer(
      "/",
      "/",
      <PublicLayout>
        <LandingPage />
      </PublicLayout>,
    );
    expect(landing.length).toBeGreaterThan(0);

    const login = renderOnServer("/login", "/login", <LoginPage />);
    expect(login.length).toBeGreaterThan(0);
  });

  it("renders the logged-in PublicLayout chrome with its pending-actions host for a cookie session", () => {
    const html = renderOnServer(
      "/meetings",
      "/meetings",
      <PublicLayout>
        <p>Spotkania</p>
      </PublicLayout>,
      createTestQueryClient(),
      "dummy",
    );
    expect(html).toContain("Spotkania");
  });

  it.each([
    { session: "anonymous", token: null },
    { session: "cookie", token: SESSION },
  ])("renders the $session /search page with the field and tabs, without the global bars", ({ token }) => {
    const html = renderOnServer(
      "/search?q=klocki",
      "/search",
      <BackPageLayout>
        <SearchPage />
      </BackPageLayout>,
      createTestQueryClient(),
      token,
    );
    expect(html).toContain("Wróć");
    expect(html).toContain('type="search"');
    expect(html).toContain('value="klocki"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain("Szukam…");
    expect(html).toContain('aria-label="Kategoria"');
    // The scope control sits in the closed „Filtry” sheet.
    expect(html).not.toContain('role="radiogroup"');
    expect(html.includes("Zaloguj się")).toBe(token === null);
    expect(html).not.toContain('aria-label="Menu konta"');
    expect(html).not.toContain('aria-label="Nawigacja główna"');
  });

  it.each([
    { page: "organization page", url: "/zielony-krag", pattern: "/:slug", element: ORGANIZATION_ROUTE, text: null },
    {
      page: "party profile",
      url: `/${PARTY_ID}`,
      pattern: "/:slug",
      element: PROFILE_ROUTE,
      text: null,
    },
    {
      page: "organization appearance editor",
      url: "/zielony-krag/appearance",
      pattern: "/:slug/appearance",
      element: ORGANIZATION_APPEARANCE_ROUTE,
      text: "Wygląd strony",
    },
    {
      page: "profile appearance editor",
      url: `/${PARTY_ID}/appearance`,
      pattern: "/:slug/appearance",
      element: PROFILE_APPEARANCE_ROUTE,
      text: "Wygląd strony",
    },
    {
      page: "organizer item page",
      url: "/zielony-krag/product/it-1",
      pattern: "/:slug/product/:id",
      element: ORGANIZER_ITEM_ROUTE,
      text: null,
    },
    {
      page: "event page",
      url: `/zielony-krag/event/${EVENT_ID}`,
      pattern: "/:slug/event/:eventId",
      element: EVENT_ROUTE,
      text: "Piknik w parku",
    },
    {
      page: "term page",
      url: `/ania/group/${GROUP_ID}/term/${TERM_ID}`,
      pattern: "/:slug/group/:groupId/term/:termId",
      element: TERM_ROUTE,
      text: "Muzyczne Skrzaty",
    },
  ])("renders the $page in the logged-in chrome for a cookie session", ({ url, pattern, element, text }) => {
    const client = createTestQueryClient();
    client.setQueryData([EVENT_KEY, EVENT_ID], { data: EVENT, forToken: SESSION });
    client.setQueryData([GROUP_ACCESS_KEY, GROUP_ID, TERM_ID], { data: ACCESS, forToken: SESSION });

    const html = renderOnServer(url, pattern, <PublicLayout>{element}</PublicLayout>, client, SESSION);

    expect(html.length).toBeGreaterThan(0);
    if (text !== null) expect(html).toContain(text);
  });

  it("renders a loaded party profile and its owner's appearance editor for a cookie session", () => {
    const client = createTestQueryClient();
    client.setQueryData([OWNER_ITEMS_KEY, "profile", PARTY_ID, "ania@example.com"], PARTY_PROFILE);
    // The server render stands in "server-session" for the cookie token it only has the claims of.
    client.setQueryData([MY_PROFILE_KEY, "server-session"], MY_PROFILE);

    const profile = renderOnServer(`/${PARTY_ID}`, "/:slug", <PublicLayout>{PROFILE_ROUTE}</PublicLayout>, client, SESSION);
    expect(profile).toContain("Oddaję ubranka po córce.");
    expect(profile).toContain(`href="/${PARTY_ID}/appearance"`);

    const editor = renderOnServer(
      `/${PARTY_ID}/appearance?tab=layout`,
      "/:slug/appearance",
      <PublicLayout>{PROFILE_APPEARANCE_ROUTE}</PublicLayout>,
      client,
      SESSION,
    );
    expect(editor).toContain("Układ strony");
    expect(editor).toContain("Dla organizacji");
  });

  it("renders a loaded item page with the owner's location card for a cookie session", async () => {
    const client = createTestQueryClient();
    client.setQueryData([ITEM_DETAILS_KEY, ITEM_ID], ITEM);
    client.setQueryData([ITEM_ACTIONS_KEY, ITEM_ID, "ania@example.com"], ITEM_ACTIONS);

    const html = renderOnServer(
      `/party-1/product/${ITEM_ID}`,
      "/:slug/product/:id",
      <PublicLayout>{await itemRouteElement(`/party-1/product/${ITEM_ID}`)}</PublicLayout>,
      client,
      SESSION,
    );

    expect(html).toContain("Lokalizacja przedmiotu");
    expect(html).toContain(ITEM_ADDRESS);
  });

  it("renders the item page shell while its data is loading", async () => {
    const html = renderOnServer(
      "/ania/product/it-1",
      "/:slug/product/:id",
      await itemRouteElement("/ania/product/it-1"),
    );
    expect(html.length).toBeGreaterThan(0);
  });

  it("renders a loaded event page with an origin-less share link", () => {
    const client = createTestQueryClient();
    client.setQueryData([EVENT_KEY, EVENT_ID], { data: EVENT, forToken: null });
    const html = renderOnServer(
      `/zielony-krag/event/${EVENT_ID}`,
      "/:slug/event/:eventId",
      EVENT_ROUTE,
      client,
    );
    expect(html).toContain("Piknik w parku");
  });

  it("renders a loaded public term page without reading storage", () => {
    const client = createTestQueryClient();
    client.setQueryData([GROUP_ACCESS_KEY, GROUP_ID, TERM_ID], { data: ACCESS, forToken: null });
    const html = renderOnServer(
      `/ania/group/${GROUP_ID}/term/${TERM_ID}`,
      "/:slug/group/:groupId/term/:termId",
      TERM_ROUTE,
      client,
    );
    expect(html).toContain("Muzyczne Skrzaty");
  });
});

describe("getQueryClient", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("returns a new client per server render and one singleton in the browser, keeping the retry policy", async () => {
    const server = await import("../api/queryClient");
    expect(server.getQueryClient()).not.toBe(server.getQueryClient());

    vi.resetModules();
    vi.stubGlobal("window", {});
    const browser = await import("../api/queryClient");
    const { ApiError } = await import("../api/client");
    const client = browser.getQueryClient();
    expect(browser.getQueryClient()).toBe(client);

    const retry = client.getDefaultOptions().queries?.retry;
    if (typeof retry !== "function") throw new Error("retry policy missing");
    expect(retry(0, new ApiError(404, "Not Found", null))).toBe(false);
    expect(retry(0, new Error("network"))).toBe(true);
    expect(retry(2, new Error("network"))).toBe(false);
  });
});
