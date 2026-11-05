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
import { AuthProvider } from "../auth/AuthContext";
import { PublicLayout } from "../components/layout/PublicLayout";
import { LoginPage } from "../features/auth/LoginPage";
import { itemRouteElement } from "./itemRoute";
import { eventRouteElement } from "./eventRoute";
import { termRouteElement } from "./termRoute";
import { LandingPage } from "../features/landing/LandingPage";
import { OwnerPage } from "../features/owner-page/OwnerPage";
import { EVENT_KEY } from "../hooks/useEvent";
import { ITEM_ACTIONS_KEY } from "../hooks/useItemActions";
import { ITEM_DETAILS_KEY } from "../hooks/useItemDetail";
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
    { page: "owner page", url: "/zielony-krag", pattern: "/:slug", element: <OwnerPage />, text: null },
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
