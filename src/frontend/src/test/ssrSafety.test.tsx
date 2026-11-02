// @vitest-environment node
import { ChakraProvider } from "@chakra-ui/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventDetailResponse } from "../api/events";
import type { GroupAccessResponse } from "../api/groups";
import { AuthProvider } from "../auth/AuthContext";
import { PublicLayout } from "../components/layout/PublicLayout";
import { LoginPage } from "../features/auth/LoginPage";
import { EventPage } from "../features/events/EventPage";
import { ItemDetailPage } from "../features/items/product/ItemDetailPage";
import { LandingPage } from "../features/landing/LandingPage";
import { TermPage } from "../features/terms/TermPage";
import { EVENT_KEY } from "../hooks/useEvent";
import { GROUP_ACCESS_KEY } from "../hooks/useTermAccess";
import { system } from "../theme/system";
import { createTestQueryClient } from "./queryClient";
import { routeElement } from "./renderWithRoute";

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

/** The app's provider stack around one routed page, rendered as on the server. */
function renderOnServer(
  url: string,
  pattern: string,
  page: ReactElement,
  client: QueryClient = createTestQueryClient(),
): string {
  return renderToString(
    <QueryClientProvider client={client}>
      <ChakraProvider value={system}>
        <AuthProvider initialToken={null}>
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

  it("renders the item page shell while its data is loading", () => {
    const html = renderOnServer("/product/it-1", "/product/:id", <ItemDetailPage />);
    expect(html.length).toBeGreaterThan(0);
  });

  it("renders a loaded event page with an origin-less share link", () => {
    const client = createTestQueryClient();
    client.setQueryData([EVENT_KEY, EVENT_ID], { data: EVENT, forToken: null });
    const html = renderOnServer(
      `/zielony-krag/event/${EVENT_ID}`,
      "/:organizationSlug/event/:eventId",
      <EventPage />,
      client,
    );
    expect(html).toContain("Piknik w parku");
  });

  it("renders a loaded public term page without reading storage", () => {
    const client = createTestQueryClient();
    client.setQueryData([GROUP_ACCESS_KEY, GROUP_ID, TERM_ID], { data: ACCESS, forToken: null });
    const html = renderOnServer(
      `/ania/group/${GROUP_ID}/term/${TERM_ID}`,
      "/:organizationSlug/group/:groupId/term/:termId",
      <TermPage />,
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
