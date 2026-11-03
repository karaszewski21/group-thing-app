import { fireEvent, renderHook, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicOrganizationResponse } from "../api/organizations";
import * as organizationsApi from "../api/organizations";
import type { OwnerItemCard, OwnerItemsPageResponse, OwnerNearestDate } from "../api/ownerItems";
import * as ownerItemsApi from "../api/ownerItems";
import { useOwnerItems } from "../hooks/useOwnerItems";
import { OwnerItemsPage } from "../features/owner-page/OwnerItemsPage";
import { createQueryWrapper } from "./queryClient";
import { getTestLocation, getTestRouter, renderWithRoute } from "./renderWithRoute";

const mockAuth: { token: string | null; username: string | null } = { token: null, username: null };
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));

vi.mock("../api/organizations", () => ({
  getPublicOrganization: vi.fn(),
}));

vi.mock("../api/ownerItems", () => ({
  getOrganizationOwnerItems: vi.fn(),
  getPartyOwnerItems: vi.fn(),
}));

const SLUG = "akademia-orlik";
const PARTY_ID = "0b6f3c1e-9a7d-4c2e-8f1a-2d3e4f5a6b7c";

const ORGANIZATION: PublicOrganizationResponse = {
  slug: SLUG,
  name: "Akademia Orlik",
  primary_color: "#7a1f3d",
  accent_color: "#d4a017",
  page_layout: "EXCHANGE",
  palette_preset: null,
  description: null,
  logo: null,
  cover: null,
  gallery: [],
};

function card(id: string, mode: OwnerItemCard["mode"], overrides: Partial<OwnerItemCard> = {}): OwnerItemCard {
  return {
    item_id: id,
    product_name: `Rzecz ${id}`,
    condition: "GOOD",
    mode,
    thumb_url: null,
    added_at: "2026-10-30T09:00:00",
    reservation: null,
    ...overrides,
  };
}

// 2026-11-07 is a Saturday ("sob 7 lis").
const NEAREST_EVENT: OwnerNearestDate = {
  kind: "EVENT",
  id: "e1",
  name: "Wymianka sąsiedzka",
  starts_at: "2026-11-07T10:00:00",
  location_name: "Park Jordana, Kraków",
  attendee_count: 14,
  path: `/${SLUG}/event/e1`,
};

function ownerPage(overrides: Partial<OwnerItemsPageResponse> = {}): OwnerItemsPageResponse {
  return {
    owner: { party_id: PARTY_ID, display_name: "Akademia Orlik", slug: SLUG },
    nearest: NEAREST_EVENT,
    counts: { GIFT: 2, SWAP: 1 },
    items: [card("i1", "GIFT"), card("i2", "SWAP"), card("i3", "GIFT")],
    total: 3,
    page: 1,
    size: 20,
    ...overrides,
  };
}

function renderAt(path: string) {
  renderWithRoute(<OwnerItemsPage />, {
    url: path,
    pattern: "/:slug/items",
    wrapper: createQueryWrapper(),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth.token = null;
  mockAuth.username = null;
  vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue(ORGANIZATION);
});

describe("OwnerItemsPage", () => {
  it("keeps the nearest date card and shows intent pills on tiles linking to the plain product page", async () => {
    vi.mocked(ownerItemsApi.getOrganizationOwnerItems).mockResolvedValue(ownerPage());

    renderAt(`/${SLUG}/items`);

    const heading = await screen.findByRole("heading", { level: 1, name: "Rzeczy: Akademia Orlik" });
    expect(heading.closest("[data-organizer-theme]")).toHaveAttribute("data-organizer-theme", "custom");
    expect(screen.getByText("3 rzeczy do oddania lub zamiany")).toBeInTheDocument();
    expect(screen.getByText("Najbliższa okazja do odbioru")).toBeInTheDocument();
    expect(screen.getByText("sobota, 7 listopada · 10:00")).toBeInTheDocument();
    expect(screen.getByText("Park Jordana, Kraków · 14 zapisanych")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zobacz wydarzenie i zapisz się" })).toHaveAttribute(
      "href",
      `/${SLUG}/event/e1`,
    );
    expect(screen.getByRole("link", { name: "Rzecz i1" })).toHaveAttribute("href", `/${SLUG}/product/i1`);
    const [gift, swap] = screen.getAllByRole("article");
    expect(within(gift).getByText("Chcę oddać")).toHaveClass("bg-primary-soft", "text-primary-fg");
    expect(within(swap).getByText("Chcę się zamienić")).toHaveClass("bg-accent-soft", "text-accent-fg");
    expect(gift).not.toHaveTextContent("sob 7 lis");
    expect(within(gift).queryByRole("button")).not.toBeInTheDocument();
    expect(ownerItemsApi.getOrganizationOwnerItems).toHaveBeenCalledWith(SLUG, 1, undefined);
  });

  it("shows the chat-only notice and intent pills without a nearest date", async () => {
    vi.mocked(ownerItemsApi.getPartyOwnerItems).mockResolvedValue(
      ownerPage({
        owner: { party_id: PARTY_ID, display_name: "Ania W.", slug: null },
        nearest: null,
        counts: { GIFT: 1, SWAP: 1 },
        items: [card("i1", "GIFT"), card("i2", "SWAP")],
        total: 2,
      }),
    );

    renderAt(`/${PARTY_ID}/items`);

    expect(await screen.findByText("Ania W. nie ma teraz zaplanowanych spotkań")).toBeInTheDocument();
    expect(screen.getByText("Napisz w sprawie konkretnej rzeczy — umówicie się na czacie.")).toBeInTheDocument();
    expect(screen.queryByText("Najbliższa okazja do odbioru")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Rzecz i1" })).toHaveAttribute("href", `/${PARTY_ID}/product/i1`);
    const [gift, swap] = screen.getAllByRole("article");
    expect(within(gift).getByText("Chcę oddać")).toBeInTheDocument();
    expect(within(swap).getByText("Chcę się zamienić")).toBeInTheDocument();
    expect(ownerItemsApi.getPartyOwnerItems).toHaveBeenCalledWith(PARTY_ID, 1, undefined);
    expect(organizationsApi.getPublicOrganization).not.toHaveBeenCalled();
  });

  it("refetches with the mode when a filter tab is picked while the counts stay", async () => {
    vi.mocked(ownerItemsApi.getOrganizationOwnerItems).mockImplementation(async (_slug, _page, mode) =>
      mode === "GIFT" ? ownerPage({ items: [card("i1", "GIFT"), card("i3", "GIFT")], total: 2 }) : ownerPage(),
    );

    renderAt(`/${SLUG}/items`);

    const tablist = await screen.findByRole("tablist");
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Wszystkie 3", "Chcę oddać 2", "Chcę się zamienić 1"]);

    fireEvent.click(within(tablist).getByRole("tab", { name: "Chcę oddać 2" }));

    await waitFor(() => expect(ownerItemsApi.getOrganizationOwnerItems).toHaveBeenCalledWith(SLUG, 1, "GIFT"));
    await waitFor(() => expect(screen.queryByRole("link", { name: "Rzecz i2" })).not.toBeInTheDocument());
    expect(within(tablist).getByRole("tab", { name: "Chcę oddać 2" })).toHaveAttribute("aria-selected", "true");
    expect(within(tablist).getByRole("tab", { name: "Wszystkie 3" })).toBeInTheDocument();
    expect(within(tablist).getByRole("tab", { name: "Chcę się zamienić 1" })).toBeInTheDocument();
  });

  it("shows an anonymous viewer the reserved pill without a name, next to the intent pill", async () => {
    vi.mocked(ownerItemsApi.getOrganizationOwnerItems).mockResolvedValue(
      ownerPage({
        items: [card("i1", "GIFT", { reservation: { by_name: null, by_me: false } }), card("i2", "SWAP")],
        total: 2,
      }),
    );

    renderAt(`/${SLUG}/items`);

    await screen.findByRole("link", { name: "Rzecz i1" });
    const [reserved] = screen.getAllByRole("article");
    const pill = within(reserved).getByText("Zarezerwowana");
    expect(pill).toHaveClass("bg-teal-soft");
    expect(pill).toHaveTextContent(/^Zarezerwowana$/);
    expect(within(reserved).getByText("Chcę oddać")).toBeInTheDocument();
    expect(screen.queryByText(/przez/)).not.toBeInTheDocument();
    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Wszystkie 3", "Chcę oddać 2", "Chcę się zamienić 1"]);
  });

  it("refetches the owner items under a new key after a login", async () => {
    vi.mocked(ownerItemsApi.getOrganizationOwnerItems).mockResolvedValue(ownerPage());
    const { result, rerender } = renderHook(() => useOwnerItems({ kind: "organization", slug: SLUG }), {
      wrapper: createQueryWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(ownerItemsApi.getOrganizationOwnerItems).toHaveBeenCalledTimes(1);

    mockAuth.token = "jwt";
    mockAuth.username = "user-1";
    rerender();

    await waitFor(() => expect(ownerItemsApi.getOrganizationOwnerItems).toHaveBeenCalledTimes(2));
  });

  it("redirects an organization owner's party URL to the slug URL, keeping the query", async () => {
    vi.mocked(ownerItemsApi.getPartyOwnerItems).mockResolvedValue(ownerPage());
    vi.mocked(ownerItemsApi.getOrganizationOwnerItems).mockResolvedValue(ownerPage());

    renderAt(`/${PARTY_ID}/items?event=e9`);

    await waitFor(() => {
      const { pathname, search } = getTestLocation();
      expect(pathname + search).toBe(`/${SLUG}/items?event=e9`);
    });
    expect(getTestRouter().calls).toEqual([{ method: "replace", url: `/${SLUG}/items?event=e9`, scroll: true }]);
  });

  it("ignores a ?term= on the page and links tiles to the plain product page", async () => {
    vi.mocked(ownerItemsApi.getOrganizationOwnerItems).mockResolvedValue(ownerPage());

    renderAt(`/${SLUG}/items?term=t9`);

    expect(await screen.findByRole("link", { name: "Rzecz i2" })).toHaveAttribute("href", `/${SLUG}/product/i2`);
  });

  it("loads the next page on 'Pokaż więcej'", async () => {
    vi.mocked(ownerItemsApi.getOrganizationOwnerItems).mockImplementation(async (_slug, page) =>
      page === 1
        ? ownerPage({ counts: { GIFT: 21, SWAP: 0 }, items: [card("i1", "GIFT")], total: 21 })
        : ownerPage({ counts: { GIFT: 21, SWAP: 0 }, items: [card("i21", "GIFT")], total: 21, page: 2 }),
    );

    renderAt(`/${SLUG}/items`);

    fireEvent.click(await screen.findByRole("button", { name: "Pokaż więcej" }));

    expect(await screen.findByRole("link", { name: "Rzecz i21" })).toBeInTheDocument();
    expect(ownerItemsApi.getOrganizationOwnerItems).toHaveBeenCalledWith(SLUG, 2, undefined);
    expect(screen.getByRole("link", { name: "Rzecz i1" })).toBeInTheDocument();
  });
});
