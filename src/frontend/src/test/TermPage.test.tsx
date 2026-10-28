import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { TermPage } from "../pages/term/TermPage";
import * as groupsApi from "../api/groups";
import * as familiesApi from "../api/families";
import * as pledgesApi from "../api/pledges";
import * as termItemListingsApi from "../api/termItemListings";
import * as inventoriesApi from "../api/inventories";
import { ApiError } from "../api/client";
import type { GroupAccessResponse, PublicCircleResponse } from "../api/groups";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/groups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/groups")>();
  return {
    ...actual,
    getGroupAccess: vi.fn(),
    createRsvp: vi.fn(),
    mergeAnonymousProfile: vi.fn(),
    redeemJoinCode: vi.fn(),
  };
});
vi.mock("../api/pledges", () => ({ createPledge: vi.fn() }));
vi.mock("../api/families", () => ({ getMyFamilies: vi.fn() }));
vi.mock("../api/termItemListings", () => ({ takeTermItemListing: vi.fn(), proposeSwap: vi.fn() }));
vi.mock("../api/inventories", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/inventories")>()),
  getMyInventoryItems: vi.fn(),
  getInventoryItemBalance: vi.fn(),
}));

const conversationHook = vi.hoisted(() => ({ openConversation: vi.fn() }));
vi.mock("../hooks/useOpenConversation", () => ({ useOpenConversation: () => conversationHook }));

let mockAuth: { token: string | null; displayName: string | null };

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ ...mockAuth, applyExternalToken: vi.fn() }),
}));

// Term/Group ids are UUID strings end to end (spec R29) — route params are never coerced.
const GROUP_ID = "5f0c2a7e-3b1d-4e6a-9c8f-0000000000a5";
const TERM_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0000000000c1";
const OTHER_TERM_ID = "7d8e9fa0-b1c2-4d3e-8f4a-0000000000c7";
const PATH = `/zajecia/grupa/${GROUP_ID}/term/${TERM_ID}`;

const circle: PublicCircleResponse = {
  id: "7",
  name: "Muzyczne Skrzaty",
  organizer_display_name: "Ania Kowalska",
  organizer_slug: "ania",
  visibility: "PUBLIC",
  layout_mode: "CIRCLE",
  organization: null,
  term: {
    id: "101",
    occurs_on: "2026-10-01T17:00:00",
    description: "Zajęcia w parku",
    location: {
      name: "Świetlica na Polnej",
      formatted_address: "ul. Polna 12, 60-595 Poznań",
      google_place_id: "ChIJ-polna",
      lat: 52.4,
      lng: 16.9,
      notes: "wejście od podwórza",
    },
    capacity: 12,
    attendee_count: 3,
    needed_items: [
      {
        id: "11",
        name: "Bębenek",
        description: null,
        claimed: false,
        claimed_by_name: null,
        claimed_by_party_id: null,
      },
    ],
    item_listings: [
      {
        id: "9",
        item_id: "9",
        product_name: "Rowerek",
        condition: "GOOD",
        offered_types: ["GIFT"],
        lister_party_id: "21",
        lister_display_name: "Ola Nowak",
        thumb_url: null,
      },
      {
        id: "10",
        item_id: "10",
        product_name: "Namiot",
        condition: "GOOD",
        offered_types: ["GIFT"],
        lister_party_id: "99",
        lister_display_name: "Ania Kowalska",
        thumb_url: null,
      },
    ],
  },
  guardians: [
    { party_id: "21", display_name: "Ola Nowak" },
    { party_id: "22", display_name: "Piotr Zieliński" },
  ],
};

// The page keys the guest RSVP off the public payload's ids (still typed as numbers there).
const GUEST_KEY = groupsApi.guestProfileIdKey(`${circle.id}`, `${circle.term!.id}`);

function access(
  overrides: { group?: Partial<PublicCircleResponse>; access?: Partial<GroupAccessResponse["access"]> } = {},
): GroupAccessResponse {
  return {
    group: { ...circle, ...overrides.group },
    access: {
      is_member: false,
      is_organizer: false,
      can_view_content: true,
      is_attending: false,
      is_active_attendee: false,
      ...overrides.access,
    },
  };
}

function SearchProbe() {
  const { search, hash } = useLocation();
  return (
    <>
      <span data-testid="search">{search}</span>
      <span data-testid="hash">{hash}</span>
    </>
  );
}

function page(entry = PATH) {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/:organizationSlug/grupa/:groupId/term/:termId" element={<TermPage />} />
        <Route path="/wiadomosci/:id" element={<p>Wątek rozmowy</p>} />
      </Routes>
      <SearchProbe />
    </MemoryRouter>
  );
}

function renderPage(entry = PATH) {
  return render(page(entry), { wrapper: createQueryWrapper() });
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  mockAuth = { token: null, displayName: null };
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(access());
  vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([]);
});

describe("TermPage — header and content", () => {
  it("shows the group name with the term description as the header subtitle", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { level: 1, name: "Muzyczne Skrzaty" })).toBeInTheDocument();
    expect(screen.getByText("Zajęcia w parku")).toBeInTheDocument();
    expect(groupsApi.getGroupAccess).toHaveBeenCalledWith(GROUP_ID, TERM_ID);
  });

  it("renders no subtitle when the term has no description", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(
      access({ group: { term: { ...circle.term!, description: null } } }),
    );
    const { container } = renderPage();

    await screen.findByRole("heading", { level: 1, name: "Muzyczne Skrzaty" });
    expect(container.querySelector("header h1 + p")).toBeNull();
  });

  it("draws signed-up people in the group's layout, with the shares/brings markers", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(
      access({
        group: {
          layout_mode: "TABLE",
          term: {
            ...circle.term!,
            needed_items: [{ ...circle.term!.needed_items[0], claimed: true, claimed_by_party_id: "22" }],
          },
        },
      }),
    );
    renderPage();

    expect(await screen.findByTestId("table-chips")).toBeInTheDocument();
    const ola = screen.getByRole("button", { name: "Ola Nowak" });
    const piotr = screen.getByRole("button", { name: "Piotr Zieliński" });
    expect(within(ola).getByLabelText("Udostępnia rzecz")).toBeInTheDocument();
    expect(within(piotr).getByLabelText("Przynosi na zajęcia")).toBeInTheDocument();
    // the organizer offers an item but isn't signed up — listed, not drawn.
    expect(screen.queryByRole("button", { name: "Ania Kowalska" })).not.toBeInTheDocument();
  });

  it("clicking an avatar scrolls to and focuses that person's entry in the list", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Ola Nowak" }));

    const entry = document.getElementById("attendee-21")!;
    expect(entry.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(entry).toHaveFocus();
    expect(entry).toHaveAttribute("data-active", "true");
  });

  it("lists every attendee with their own offered items, plus non-attending listers", async () => {
    renderPage();

    const list = await screen.findByRole("region", { name: "Zapisani na zajęcia" });
    const ola = document.getElementById("attendee-21")!;
    expect(within(ola).getByText("Rowerek")).toBeInTheDocument();
    expect(within(ola).getByRole("button", { name: "Weź na stałe: Rowerek" })).toBeInTheDocument();
    expect(within(document.getElementById("attendee-22")!).queryAllByRole("button")).toHaveLength(0);
    expect(within(list).getByText("Ania Kowalska")).toBeInTheDocument();
    expect(within(document.getElementById("attendee-99")!).getByText("Namiot")).toBeInTheDocument();
  });

  it("links each offered item's title to its item page, leaving needed items plain", async () => {
    renderPage();

    await screen.findByRole("region", { name: "Zapisani na zajęcia" });
    const ola = document.getElementById("attendee-21")!;
    expect(within(ola).getByRole("link", { name: "Rowerek" })).toHaveAttribute("href", "/ania/produkt/9");
    expect(within(document.getElementById("attendee-99")!).getByRole("link", { name: "Namiot" })).toHaveAttribute(
      "href",
      "/ania/produkt/10",
    );
    expect(screen.getAllByText("Bębenek").length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: /Bębenek/ })).toBeNull();
  });

  it("links items to the unprefixed item page when the group has no organizer slug", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(access({ group: { organizer_slug: null } }));
    renderPage();

    await screen.findByRole("region", { name: "Zapisani na zajęcia" });
    expect(
      within(document.getElementById("attendee-21")!).getByRole("link", { name: "Rowerek" }),
    ).toHaveAttribute("href", "/product/9");
  });
});

describe("TermPage — place and capacity", () => {
  it("shows the place with notes and a Google Maps link in the term card", async () => {
    renderPage();

    const card = await screen.findByRole("region", { name: "Termin zajęć" });
    expect(within(card).getByText("Miejsce")).toBeInTheDocument();
    expect(within(card).getByText("Świetlica na Polnej")).toBeInTheDocument();
    expect(within(card).getByText("ul. Polna 12, 60-595 Poznań")).toBeInTheDocument();
    expect(within(card).getByText("wejście od podwórza")).toBeInTheDocument();
    const link = within(card).getByRole("link", { name: "Otwórz w Google Maps (nowa karta)" });
    expect(link).toHaveAttribute("href", expect.stringContaining("query_place_id=ChIJ-polna"));
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("omits the place block and the capacity line when neither is set", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(
      access({ group: { term: { ...circle.term!, location: null, capacity: null } } }),
    );
    renderPage();

    const card = await screen.findByRole("region", { name: "Termin zajęć" });
    expect(within(card).queryByText("Miejsce")).not.toBeInTheDocument();
    expect(within(card).queryByRole("link")).not.toBeInTheDocument();
    expect(within(card).queryByText(/Zapisanych/)).not.toBeInTheDocument();
  });

  it("shows how many places are taken without a full notice while places remain", async () => {
    renderPage();

    const card = await screen.findByRole("region", { name: "Termin zajęć" });
    expect(within(card).getByText("Zapisanych 3 z 12")).toBeInTheDocument();
    expect(within(card).queryByText("Brak wolnych miejsc")).not.toBeInTheDocument();
  });

  it("a full term shows 'Brak wolnych miejsc' as a status and keeps the sign-up button enabled", async () => {
    mockAuth = { token: "tok", displayName: "Ala" };
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(
      access({ group: { term: { ...circle.term!, capacity: 12, attendee_count: 12 } } }),
    );
    renderPage();

    const card = await screen.findByRole("region", { name: "Termin zajęć" });
    expect(within(card).getByText("Zapisanych 12 z 12")).toBeInTheDocument();
    expect(within(card).getByRole("status")).toHaveTextContent("Brak wolnych miejsc");
    expect(screen.getByRole("button", { name: "＋ Zapisz się na zajęcia" })).toBeEnabled();
  });
});

const BORDO_ORGANIZATION = { name: "Bordowe Nutki", primary_color: "#7a2a4f", accent_color: null, palette_preset: null };

describe("TermPage — organizer theme", () => {
  it("renders the term view inside the organizer's color scope", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(access({ group: { organization: BORDO_ORGANIZATION } }));
    renderPage();

    const heading = await screen.findByRole("heading", { level: 1, name: "Muzyczne Skrzaty" });
    const scope = heading.closest<HTMLElement>('[data-organizer-theme="custom"]');
    expect(scope).not.toBeNull();
    expect(scope!.style.getPropertyValue("--color-primary")).toBe("#7a2a4f");
    expect(scope).toContainElement(screen.getByRole("region", { name: "Zapisani na zajęcia" }));
  });

  it("renders the private group gate inside the same scope", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(privateAccess({ group: { organization: BORDO_ORGANIZATION } }));
    renderPage();

    const gate = await screen.findByRole("heading", { level: 2, name: /Ta grupa jest prywatna/ });
    const scope = gate.closest<HTMLElement>('[data-organizer-theme="custom"]');
    expect(scope).not.toBeNull();
    expect(scope!.style.getPropertyValue("--color-primary")).toBe("#7a2a4f");
  });

  it("keeps the not-found state outside any organizer scope", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockRejectedValue(new Error("404"));
    const { container } = renderPage();

    expect(await screen.findByText("Nie znaleziono")).toBeInTheDocument();
    expect(container.querySelector("[data-organizer-theme]")).toBeNull();
  });
});

describe("TermPage — sign-up footer", () => {
  it("anonymous: 'Zaloguj się, żeby się zapisać' opens the login / guest choice", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Zaloguj się, żeby się zapisać" }));

    const sheet = screen.getByRole("dialog", { name: "Zapisz się na zajęcia" });
    expect(within(sheet).getByRole("link", { name: "Zaloguj się" })).toHaveAttribute(
      "href",
      `/login?returnTo=${encodeURIComponent(PATH)}`,
    );
    fireEvent.click(within(sheet).getByRole("button", { name: "Zapisz się jako gość" }));
    expect(await screen.findByLabelText("Imię")).toBeInTheDocument();
  });

  it("logged in, not attending: 'Zapisz się na zajęcia' opens the logged-in RSVP dialog", async () => {
    mockAuth = { token: "tok", displayName: "Ala" };
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "＋ Zapisz się na zajęcia" }));

    expect(await screen.findByRole("dialog", { name: "Zapisz się na zajęcia" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Imię")).not.toBeInTheDocument();
  });

  it("logged-in RSVP banner links to family view with returnTo", async () => {
    mockAuth = { token: "tok", displayName: "Ala" };
    vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([
      { id: "3", party_id: "4", name: "Kowalscy", child_count: 0, created_at: "", updated_at: "" },
    ]);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "＋ Zapisz się na zajęcia" }));

    const dialog = await screen.findByRole("dialog", { name: "Zapisz się na zajęcia" });
    await waitFor(() => expect(familiesApi.getMyFamilies).toHaveBeenCalled());
    expect(within(dialog).getByRole("link", { name: "Przejdź do „Mój dom”" })).toHaveAttribute(
      "href",
      `/rodzina?returnTo=${encodeURIComponent(PATH)}`,
    );
  });

  it("logged in and attending: no sign-up button", async () => {
    mockAuth = { token: "tok", displayName: "Ala" };
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(access({ access: { is_attending: true } }));
    renderPage();

    await screen.findByRole("heading", { level: 1, name: "Muzyczne Skrzaty" });
    expect(screen.queryByRole("button", { name: /Zapisz się/ })).not.toBeInTheDocument();
  });

  it("a guest who already RSVP'd sees no sign-up button and gets the account form instead of the gate", async () => {
    groupsApi.writeGuestProfile(GUEST_KEY, "55");
    renderPage();

    await screen.findByRole("heading", { level: 1, name: "Muzyczne Skrzaty" });
    expect(screen.queryByRole("button", { name: /Zapisz się|żeby się zapisać/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ja to przyniosę: Bębenek" }));

    expect(screen.getByRole("form", { name: /Załóż konto/ })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("TermPage — chat entry points", () => {
  const TERM_CHAT = "Czat terminu";
  const GROUP_CHAT = "Czat grupy";

  it.each([
    ["a PRIVATE member attendee sees both", "tok", "PRIVATE", { is_member: true, is_active_attendee: true }, [TERM_CHAT, GROUP_CHAT]],
    ["a PUBLIC attendee sees only the term chat", "tok", "PUBLIC", { is_active_attendee: true }, [TERM_CHAT]],
    ["a withdrawn non-member attendee sees neither", "tok", "PUBLIC", { is_attending: true }, []],
    ["the organizer of a PRIVATE group sees both", "tok", "PRIVATE", { is_organizer: true }, [TERM_CHAT, GROUP_CHAT]],
    ["an anonymous guest who RSVP'd sees none", null, "PUBLIC", { is_attending: true }, []],
  ] as const)("%s", async (_label, token, visibility, flags, expected) => {
    mockAuth = { token, displayName: token ? "Ala" : null };
    if (token === null) groupsApi.writeGuestProfile(GUEST_KEY, "55");
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(access({ group: { visibility }, access: flags }));
    renderPage();

    await screen.findByText("Zajęcia w parku");
    const shown = [TERM_CHAT, GROUP_CHAT].filter((name) => screen.queryByRole("button", { name }) !== null);
    expect(shown).toEqual(expected);
  });

  it("'Czat terminu' opens the term conversation and navigates to the thread", async () => {
    mockAuth = { token: "tok", displayName: "Ala" };
    conversationHook.openConversation.mockResolvedValue("conv-1");
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(access({ access: { is_active_attendee: true } }));
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: TERM_CHAT }));

    expect(await screen.findByText("Wątek rozmowy")).toBeInTheDocument();
    expect(conversationHook.openConversation).toHaveBeenCalledWith({ kind: "TERM", id: circle.term!.id });
  });

  it("'Czat grupy' shows the server's message inline when opening fails", async () => {
    mockAuth = { token: "tok", displayName: "Ala" };
    conversationHook.openConversation.mockRejectedValue(new Error("Zbyt wiele prób — spróbuj później"));
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(
      access({ group: { visibility: "PRIVATE" }, access: { is_member: true } }),
    );
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: GROUP_CHAT }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Zbyt wiele prób — spróbuj później");
    expect(conversationHook.openConversation).toHaveBeenCalledWith({ kind: "GROUP", id: circle.id });
    expect(screen.queryByText("Wątek rozmowy")).not.toBeInTheDocument();
  });
});

describe("TermPage — item actions", () => {
  it("anonymous 'Ja to przyniosę' opens the account gate and never pledges", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Ja to przyniosę: Bębenek" }));

    expect(screen.getByRole("dialog", { name: "Załóż konto, aby przynieść rzecz" })).toBeInTheDocument();
    expect(pledgesApi.createPledge).not.toHaveBeenCalled();
  });

  it("logged in 'Ja to przyniosę' pledges and shows 'Przynosi: Ty'", async () => {
    mockAuth = { token: "tok", displayName: "Ala" };
    vi.mocked(pledgesApi.createPledge).mockResolvedValue({} as never);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Ja to przyniosę: Bębenek" }));

    await waitFor(() => expect(pledgesApi.createPledge).toHaveBeenCalledWith("11"));
    expect(await screen.findByText("Przynosi: Ty")).toBeInTheDocument();
  });

  it("logged in 'Weź na stałe' takes the item for the shown term", async () => {
    mockAuth = { token: "tok", displayName: "Ala" };
    vi.mocked(termItemListingsApi.takeTermItemListing).mockResolvedValue({ item_id: "9", product_name: "Rowerek" } as never);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Weź na stałe: Rowerek" }));

    await waitFor(() =>
      expect(termItemListingsApi.takeTermItemListing).toHaveBeenCalledWith("9", {
        term_id: "101",
        reservation_type: "GIFT",
      }),
    );
  });
});

describe("TermPage — take success sheet", () => {
  // 14.10.2026 is a Wednesday ("śr").
  const datedTerm = { ...circle.term!, occurs_on: "2026-10-14T16:30:00" };
  const SENTENCE = "Odbierz „Rowerek” w śr 14.10 o 16:30 — Muzyczne Skrzaty";

  beforeEach(() => {
    mockAuth = { token: "tok", displayName: "Ala" };
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(access({ group: { term: datedTerm } }));
    vi.mocked(termItemListingsApi.takeTermItemListing).mockResolvedValue({
      item_id: "9",
      product_name: "Rowerek",
    } as never);
  });

  async function takeRowerek() {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Weź na stałe: Rowerek" }));
    return screen.findByRole("dialog", { name: SENTENCE });
  }

  it("after 'Weź na stałe' shows 'Wzięte!' with the item, date and group, links to the item page and shows no toast", async () => {
    const dialog = await takeRowerek();

    expect(within(dialog).getByRole("heading", { name: "Wzięte!" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent(SENTENCE);
    const itemLink = within(dialog).getByRole("link", { name: "Zobacz rzecz" });
    expect(itemLink).toHaveAttribute("href", "/product/9");
    expect(itemLink).toHaveClass("inline-flex", "items-center", "justify-center");
    expect(within(dialog).getByRole("button", { name: /Dodaj do kalendarza/ })).toHaveClass("whitespace-nowrap");
    expect(screen.queryByText(/Wzięto!/)).not.toBeInTheDocument();
  });

  it("Esc with the calendar menu open closes only the menu; a second Esc closes the sheet", async () => {
    const dialog = await takeRowerek();
    fireEvent.click(within(dialog).getByRole("button", { name: /Dodaj do kalendarza/ }));
    const menuItem = within(dialog).getByRole("menuitem", { name: /Kalendarz Google/ });

    fireEvent.keyDown(menuItem, { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: SENTENCE })).toBeInTheDocument();

    fireEvent.keyDown(within(dialog).getByRole("button", { name: /Dodaj do kalendarza/ }), { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: SENTENCE })).not.toBeInTheDocument();
  });

  it("closing the sheet focuses main when the take button is gone after the refetch", async () => {
    vi.mocked(groupsApi.getGroupAccess)
      .mockResolvedValueOnce(access({ group: { term: datedTerm } }))
      .mockResolvedValue(
        access({
          group: { term: { ...datedTerm, item_listings: datedTerm.item_listings.filter((l) => l.item_id !== "9") } },
        }),
      );
    const dialog = await takeRowerek();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Weź na stałe: Rowerek" })).not.toBeInTheDocument());

    fireEvent.click(within(dialog).getAllByRole("button", { name: "Zamknij" })[0]);

    expect(screen.queryByRole("dialog", { name: SENTENCE })).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveFocus();
  });

  it("a swap proposal keeps its toast and opens no sheet", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(
      access({
        group: {
          term: {
            ...datedTerm,
            item_listings: [{ ...datedTerm.item_listings[0], offered_types: ["SWAP"] }],
          },
        },
      }),
    );
    vi.mocked(inventoriesApi.getMyInventoryItems).mockResolvedValue([
      { id: "50", product_name: "Kask", listing_mode: "SWAP" } as never,
    ]);
    vi.mocked(inventoriesApi.getInventoryItemBalance).mockResolvedValue({ status: "AVAILABLE" } as never);
    vi.mocked(termItemListingsApi.proposeSwap).mockResolvedValue({} as never);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Zamień: Rowerek" }));
    fireEvent.click(await screen.findByRole("button", { name: "Zaproponuj zamianę" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Zaproponowano zamianę! Szczegóły w Twoim panelu");
    expect(screen.queryByRole("dialog", { name: /Odbierz/ })).not.toBeInTheDocument();
  });
});

function privateAccess(
  overrides: { group?: Partial<PublicCircleResponse>; access?: Partial<GroupAccessResponse["access"]> } = {},
): GroupAccessResponse {
  return access({
    group: { visibility: "PRIVATE", term: null, guardians: [], ...overrides.group },
    access: { can_view_content: false, ...overrides.access },
  });
}

describe("TermPage — access", () => {
  it("anonymous on a PRIVATE group sees only the gate with login links, no term content", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(privateAccess());
    renderPage();

    expect(await screen.findByRole("heading", { level: 2, name: /Ta grupa jest prywatna/ })).toBeInTheDocument();
    expect(screen.getByText(/Zaloguj się, aby wpisać kod dostępu\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zaloguj się" })).toHaveAttribute(
      "href",
      `/login?returnTo=${encodeURIComponent(PATH)}`,
    );
    expect(screen.queryByRole("region", { name: "Zapisani na zajęcia" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mam kod dostępu" })).not.toBeInTheDocument();
  });

  it("an unknown group or term shows 'Nie znaleziono'", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockRejectedValue(new Error("404"));
    renderPage();

    expect(await screen.findByText("Nie znaleziono")).toBeInTheDocument();
  });

  it("navigating to another term whose fetch fails shows 'Nie znaleziono', not the previous term", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValueOnce(access()).mockRejectedValueOnce(new Error("404"));
    render(
      <MemoryRouter initialEntries={[PATH]}>
        <Link to={`/zajecia/grupa/${GROUP_ID}/term/${OTHER_TERM_ID}`}>Następne zajęcia</Link>
        <Routes>
          <Route path="/:organizationSlug/grupa/:groupId/term/:termId" element={<TermPage />} />
        </Routes>
      </MemoryRouter>, { wrapper: createQueryWrapper() },
    );
    expect(await screen.findByText("Zajęcia w parku")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "Następne zajęcia" }));

    expect(await screen.findByText("Nie znaleziono")).toBeInTheDocument();
    expect(screen.queryByText("Zajęcia w parku")).not.toBeInTheDocument();
    expect(groupsApi.getGroupAccess).toHaveBeenLastCalledWith(GROUP_ID, OTHER_TERM_ID);
  });
});

describe("TermPage — join a private group by code", () => {
  const WRONG_CODE = "Nieprawidłowy kod dostępu — sprawdź i spróbuj ponownie";
  const memberAccess = access({ group: { visibility: "PRIVATE" }, access: { is_member: true } });

  beforeEach(() => {
    mockAuth = { token: "tok", displayName: "Ala" };
  });

  /** The code typed into the sheet's six digit boxes. */
  function codeValue(dialog: HTMLElement) {
    const group = within(dialog).getByRole("group", { name: "Kod dostępu" });
    return within(group)
      .getAllByRole("textbox")
      .map((box) => (box as HTMLInputElement).value)
      .join("");
  }

  async function openSheet() {
    const trigger = await screen.findByRole("button", { name: "Mam kod dostępu" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Wpisz kod dostępu" });
    return { trigger, dialog, input: within(dialog).getByRole("textbox", { name: "Cyfra 1 z 6" }) };
  }

  it("a logged-in non-member is offered 'Mam kod dostępu', not a request", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(privateAccess());
    renderPage();

    expect(await screen.findByRole("button", { name: "Mam kod dostępu" })).toBeInTheDocument();
    expect(screen.getByText(/Wpisz kod dostępu od organizatora, aby dołączyć\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Poproś o dostęp" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("the sheet keeps Tab inside, closes on Esc and returns focus to 'Mam kod dostępu'", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(privateAccess());
    renderPage();
    const { trigger, dialog } = await openSheet();
    const close = within(dialog).getByRole("button", { name: "Zamknij" });
    const cancel = within(dialog).getByRole("button", { name: "Anuluj" });

    cancel.focus();
    fireEvent.keyDown(cancel, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(cancel).toHaveFocus();

    fireEvent.keyDown(cancel, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("a partial code disables 'Dołącz' without an alert until focus leaves the boxes; non-digits are ignored", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(privateAccess());
    renderPage();
    const { dialog, input } = await openSheet();
    const submit = within(dialog).getByRole("button", { name: "Dołącz" });
    const boxes = within(dialog).getAllByRole("textbox");
    expect(boxes).toHaveLength(6);
    expect(input).toHaveFocus();
    expect(submit).toBeDisabled();

    fireEvent.change(input, { target: { value: "4" } });
    expect(codeValue(dialog)).toBe("4");
    expect(boxes[1]).toHaveFocus();
    fireEvent.change(boxes[1], { target: { value: "a" } });
    expect(codeValue(dialog)).toBe("4");
    fireEvent.change(boxes[1], { target: { value: "8291" } });
    expect(codeValue(dialog)).toBe("48291");
    expect(boxes[5]).toHaveFocus();
    expect(submit).toBeDisabled();
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.blur(boxes[5], { relatedTarget: boxes[4] });
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.blur(boxes[5]);

    const alert = within(dialog).getByRole("alert");
    expect(alert).toHaveTextContent("Kod ma 6 cyfr");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toContain(alert.id);
    expect(submit).toBeDisabled();
    fireEvent.submit(input);
    expect(groupsApi.redeemJoinCode).not.toHaveBeenCalled();
  });

  it("Backspace on an empty box clears and focuses the previous one", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(privateAccess());
    renderPage();
    const { dialog, input } = await openSheet();
    const boxes = within(dialog).getAllByRole("textbox");

    fireEvent.change(input, { target: { value: "48" } });
    expect(boxes[2]).toHaveFocus();
    fireEvent.keyDown(boxes[2], { key: "Backspace" });

    expect(codeValue(dialog)).toBe("4");
    expect(boxes[1]).toHaveFocus();
  });

  it("a submit attempt with a partial code shows the alert", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(privateAccess());
    renderPage();
    const { dialog, input } = await openSheet();

    fireEvent.change(input, { target: { value: "482" } });
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.submit(input);

    expect(within(dialog).getByRole("alert")).toHaveTextContent("Kod ma 6 cyfr");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(groupsApi.redeemJoinCode).not.toHaveBeenCalled();
  });

  it("while a join is in flight Esc, the overlay and the close button do not close the sheet", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(privateAccess());
    vi.mocked(groupsApi.redeemJoinCode).mockReturnValue(new Promise(() => {}));
    renderPage();
    const { dialog, input } = await openSheet();

    fireEvent.change(input, { target: { value: "482913" } });
    fireEvent.submit(input);
    await within(dialog).findByRole("button", { name: "Dołączanie…" });

    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Zamknij" }));
    fireEvent.click(dialog.parentElement!);

    expect(screen.getByRole("dialog", { name: "Wpisz kod dostępu" })).toBeInTheDocument();
  });

  it("a pasted spaced code submitted with Enter redeems the digits exactly once", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(privateAccess());
    vi.mocked(groupsApi.redeemJoinCode).mockReturnValue(new Promise(() => {}));
    renderPage();
    const { dialog, input } = await openSheet();

    fireEvent.change(input, { target: { value: "482 913" } });
    fireEvent.submit(input);
    fireEvent.submit(input);

    const busy = await within(dialog).findByRole("button", { name: "Dołączanie…" });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(within(dialog).getByRole("button", { name: "Anuluj" })).toBeDisabled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Wpisz kod dostępu" })).toBeInTheDocument();
    expect(groupsApi.redeemJoinCode).toHaveBeenCalledTimes(1);
    expect(groupsApi.redeemJoinCode).toHaveBeenCalledWith(GROUP_ID, "482913");
  });

  it("a 409 shows the server's message inline and keeps the sheet open with the input", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(privateAccess());
    vi.mocked(groupsApi.redeemJoinCode).mockRejectedValue(new ApiError(409, "Conflict", { message: WRONG_CODE }));
    renderPage();
    const { dialog, input } = await openSheet();

    fireEvent.change(input, { target: { value: "482910" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dołącz" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(WRONG_CODE);
    expect(codeValue(dialog)).toBe("482910");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(within(dialog).getByRole("button", { name: "Dołącz" })).toBeEnabled();

    fireEvent.change(input, { target: { value: "482913" } });
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a successful join shows the term content and the 'Dołączono do grupy' toast", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValueOnce(privateAccess()).mockResolvedValue(memberAccess);
    vi.mocked(groupsApi.redeemJoinCode).mockResolvedValue({ created: true });
    renderPage();
    const { dialog, input } = await openSheet();

    fireEvent.change(input, { target: { value: "482913" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dołącz" }));

    expect(await screen.findByText("Zajęcia w parku")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Dołączono do grupy");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(/Ta grupa jest prywatna/)).not.toBeInTheDocument();
  });

  it("#code= redeems once and strips the fragment; a malformed one is stripped and opens the sheet empty", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValueOnce(privateAccess()).mockResolvedValue(memberAccess);
    vi.mocked(groupsApi.redeemJoinCode).mockResolvedValue({ created: true });
    const valid = renderPage(`${PATH}?x=1#code=482913`);

    expect(await screen.findByText("Zajęcia w parku")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("hash")).toBeEmptyDOMElement());
    expect(screen.getByTestId("search")).toHaveTextContent(/^\?x=1$/);
    expect(groupsApi.redeemJoinCode).toHaveBeenCalledTimes(1);
    expect(groupsApi.redeemJoinCode).toHaveBeenCalledWith(GROUP_ID, "482913");
    valid.unmount();

    vi.mocked(groupsApi.getGroupAccess).mockReset().mockResolvedValue(privateAccess());
    vi.mocked(groupsApi.redeemJoinCode).mockClear();
    renderPage(`${PATH}#code=12ab`);

    const dialog = await screen.findByRole("dialog", { name: "Wpisz kod dostępu" });
    expect(codeValue(dialog)).toBe("");
    await waitFor(() => expect(screen.getByTestId("hash")).toBeEmptyDOMElement());
    expect(groupsApi.redeemJoinCode).not.toHaveBeenCalled();
  });

  it("#code= from a stale link strips the fragment at once and keeps the sheet open with the server's message", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(privateAccess());
    let rejectRedeem: (err: unknown) => void = () => {};
    vi.mocked(groupsApi.redeemJoinCode).mockReturnValue(
      new Promise((_, reject) => {
        rejectRedeem = reject;
      }),
    );
    renderPage(`${PATH}#code=482913`);

    const dialog = await screen.findByRole("dialog", { name: "Wpisz kod dostępu" });
    await within(dialog).findByRole("button", { name: "Dołączanie…" });
    await waitFor(() => expect(screen.getByTestId("hash")).toBeEmptyDOMElement());

    await act(async () => rejectRedeem(new ApiError(409, "Conflict", { message: WRONG_CODE })));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(WRONG_CODE);
    expect(codeValue(dialog)).toBe("482913");
    expect(groupsApi.redeemJoinCode).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(`pendingJoinCode:${GROUP_ID}`)).toBeNull();
  });

  it("a new #code= while a 409 sheet is open shows the new code and redeems it once", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(privateAccess());
    vi.mocked(groupsApi.redeemJoinCode)
      .mockRejectedValueOnce(new ApiError(409, "Conflict", { message: WRONG_CODE }))
      .mockReturnValue(new Promise(() => {}));
    render(
      <MemoryRouter initialEntries={[`${PATH}#code=482910`]}>
        <Link to={{ pathname: PATH, hash: "#code=582913" }}>Drugi link</Link>
        <Routes>
          <Route path="/:organizationSlug/grupa/:groupId/term/:termId" element={<TermPage />} />
        </Routes>
        <SearchProbe />
      </MemoryRouter>,
      { wrapper: createQueryWrapper() },
    );
    const first = await screen.findByRole("dialog", { name: "Wpisz kod dostępu" });
    expect(await within(first).findByRole("alert")).toHaveTextContent(WRONG_CODE);
    await waitFor(() => expect(screen.getByTestId("hash")).toBeEmptyDOMElement());

    fireEvent.click(screen.getByRole("link", { name: "Drugi link" }));

    await waitFor(() => expect(groupsApi.redeemJoinCode).toHaveBeenCalledTimes(2));
    expect(groupsApi.redeemJoinCode).toHaveBeenLastCalledWith(GROUP_ID, "582913");
    const dialog = screen.getByRole("dialog", { name: "Wpisz kod dostępu" });
    expect(codeValue(dialog)).toBe("582913");
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("hash")).toBeEmptyDOMElement());
    expect(groupsApi.redeemJoinCode).toHaveBeenCalledTimes(2);
  });

  it("#code= opened by an existing member strips the fragment without redeeming", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(memberAccess);
    renderPage(`${PATH}?x=1#code=482913`);

    expect(await screen.findByText("Zajęcia w parku")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("hash")).toBeEmptyDOMElement());
    expect(screen.getByTestId("search")).toHaveTextContent(/^\?x=1$/);
    expect(groupsApi.redeemJoinCode).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("#code= survives the login round trip without entering any URL query, then redeems once", async () => {
    mockAuth = { token: null, displayName: null };
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(privateAccess());
    vi.mocked(groupsApi.redeemJoinCode).mockResolvedValue({ created: true });
    const anonymous = renderPage(`${PATH}#code=482913`);

    expect(await screen.findByText(/Masz kod\? Zaloguj się, żeby go użyć\./)).toBeInTheDocument();
    expect(screen.getByTestId("hash")).toHaveTextContent("#code=482913");
    expect(screen.getByRole("link", { name: "Zaloguj się" })).toHaveAttribute(
      "href",
      `/login?returnTo=${encodeURIComponent(PATH)}`,
    );
    expect(screen.getByRole("link", { name: "Zarejestruj się" })).toHaveAttribute(
      "href",
      `/login?tryb=rejestracja&returnTo=${encodeURIComponent(PATH)}`,
    );
    anonymous.unmount();

    // LoginPage navigates back to `returnTo`, which carries no fragment.
    mockAuth = { token: "tok", displayName: "Ala" };
    renderPage(PATH);

    const dialog = await screen.findByRole("dialog", { name: "Wpisz kod dostępu" });
    expect(codeValue(dialog)).toBe("482913");
    await waitFor(() => expect(groupsApi.redeemJoinCode).toHaveBeenCalledTimes(1));
    expect(groupsApi.redeemJoinCode).toHaveBeenCalledWith(GROUP_ID, "482913");
    expect(sessionStorage.getItem(`pendingJoinCode:${GROUP_ID}`)).toBeNull();
  });

  it("#code= waits through a token change: no redeem while the new token's access is pending, then exactly one", async () => {
    mockAuth = { token: null, displayName: null };
    let resolveAccess: (value: GroupAccessResponse) => void = () => {};
    vi.mocked(groupsApi.getGroupAccess)
      .mockResolvedValueOnce(privateAccess())
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveAccess = resolve;
        }),
      )
      .mockResolvedValue(memberAccess);
    vi.mocked(groupsApi.redeemJoinCode).mockResolvedValue({ created: true });
    const view = renderPage(`${PATH}#code=482913`);

    expect(await screen.findByText(/Masz kod\? Zaloguj się, żeby go użyć\./)).toBeInTheDocument();

    mockAuth = { token: "tok", displayName: "Ala" };
    view.rerender(page(`${PATH}#code=482913`));
    await waitFor(() => expect(groupsApi.getGroupAccess).toHaveBeenCalledTimes(2));
    expect(groupsApi.redeemJoinCode).not.toHaveBeenCalled();
    expect(screen.getByTestId("hash")).toHaveTextContent("#code=482913");

    await act(async () => resolveAccess(privateAccess()));

    expect(await screen.findByText("Zajęcia w parku")).toBeInTheDocument();
    expect(groupsApi.redeemJoinCode).toHaveBeenCalledTimes(1);
    expect(groupsApi.redeemJoinCode).toHaveBeenCalledWith(GROUP_ID, "482913");
    await waitFor(() => expect(screen.getByTestId("hash")).toBeEmptyDOMElement());
  });

  it("#code= is in sessionStorage while its redeem runs and stays there after a 401", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(privateAccess());
    let rejectRedeem: (err: unknown) => void = () => {};
    vi.mocked(groupsApi.redeemJoinCode).mockReturnValue(
      new Promise((_, reject) => {
        rejectRedeem = reject;
      }),
    );
    renderPage(`${PATH}#code=482913`);
    const saved = () => JSON.parse(sessionStorage.getItem(`pendingJoinCode:${GROUP_ID}`) ?? "null");

    const dialog = await screen.findByRole("dialog", { name: "Wpisz kod dostępu" });
    await waitFor(() => expect(screen.getByTestId("hash")).toBeEmptyDOMElement());
    expect(saved()).toMatchObject({ code: "482913" });

    await act(async () => rejectRedeem(new ApiError(401, "Unauthorized", {})));

    await within(dialog).findByRole("alert");
    expect(saved()).toMatchObject({ code: "482913" });
    expect(groupsApi.redeemJoinCode).toHaveBeenCalledTimes(1);
  });

  it("a pending code older than an hour is ignored", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(privateAccess());
    sessionStorage.setItem(
      `pendingJoinCode:${GROUP_ID}`,
      JSON.stringify({ code: "482913", savedAt: Date.now() - 2 * 60 * 60 * 1000 }),
    );
    renderPage();

    expect(await screen.findByRole("button", { name: "Mam kod dostępu" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(groupsApi.redeemJoinCode).not.toHaveBeenCalled();
  });

  it("#code= with blocked sessionStorage still redeems exactly once", async () => {
    const blocked = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    vi.stubGlobal("sessionStorage", { getItem: blocked, setItem: blocked, removeItem: blocked });
    try {
      vi.mocked(groupsApi.getGroupAccess).mockResolvedValueOnce(privateAccess()).mockResolvedValue(memberAccess);
      vi.mocked(groupsApi.redeemJoinCode).mockResolvedValue({ created: true });
      renderPage(`${PATH}#code=482913`);

      expect(await screen.findByText("Zajęcia w parku")).toBeInTheDocument();
      await waitFor(() => expect(screen.getByTestId("hash")).toBeEmptyDOMElement());
      expect(groupsApi.redeemJoinCode).toHaveBeenCalledTimes(1);
      expect(groupsApi.redeemJoinCode).toHaveBeenCalledWith(GROUP_ID, "482913");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("#code= under StrictMode redeems exactly once", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValueOnce(privateAccess()).mockResolvedValue(memberAccess);
    vi.mocked(groupsApi.redeemJoinCode).mockResolvedValue({ created: true });
    render(<StrictMode>{page(`${PATH}#code=482913`)}</StrictMode>, { wrapper: createQueryWrapper() });

    expect(await screen.findByText("Zajęcia w parku")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("hash")).toBeEmptyDOMElement());
    expect(groupsApi.redeemJoinCode).toHaveBeenCalledTimes(1);
    expect(groupsApi.redeemJoinCode).toHaveBeenCalledWith(GROUP_ID, "482913");
  });

  it("a failed fetch after a token change shows the retry line instead of a loader; a retry resolves it", async () => {
    mockAuth = { token: null, displayName: null };
    vi.mocked(groupsApi.getGroupAccess)
      .mockResolvedValueOnce(privateAccess())
      .mockRejectedValueOnce(new Error("500"))
      .mockResolvedValueOnce(privateAccess());
    const view = renderPage();
    await screen.findByRole("link", { name: "Zaloguj się" });

    mockAuth = { token: "tok", displayName: "Ala" };
    view.rerender(page());

    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się odświeżyć strony — spróbuj ponownie.");
    expect(screen.queryByText("Wczytywanie...")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Zaloguj się" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mam kod dostępu" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));

    expect(await screen.findByRole("button", { name: "Mam kod dostępu" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("TermPage — view fixes", () => {
  it("logged in with no display name yet: sign-up opens the logged-in RSVP dialog, not the guest one", async () => {
    mockAuth = { token: "tok", displayName: null };
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "＋ Zapisz się na zajęcia" }));

    expect(await screen.findByRole("dialog", { name: "Zapisz się na zajęcia" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Imię")).not.toBeInTheDocument();
  });

  it("logged in with no display name yet: hides 'Zapisujesz się jako' and blocks submit until the name loads", async () => {
    mockAuth = { token: "tok", displayName: null };
    vi.mocked(groupsApi.createRsvp).mockResolvedValue({} as never);
    const { rerender } = renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "＋ Zapisz się na zajęcia" }));
    const dialog = await screen.findByRole("dialog", { name: "Zapisz się na zajęcia" });
    expect(within(dialog).queryByText(/Zapisujesz się jako/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Zapisz się" })).toBeDisabled();

    mockAuth = { token: "tok", displayName: "Ala" };
    rerender(page());
    const submit = within(screen.getByRole("dialog", { name: "Zapisz się na zajęcia" })).getByRole("button", {
      name: "Zapisz się",
    });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => expect(groupsApi.createRsvp).toHaveBeenCalledTimes(1));
    const [, body] = vi.mocked(groupsApi.createRsvp).mock.calls[0];
    expect(body.guardian_name).toBe("Ala");
  });

  it("logged in with a display name: the RSVP dialog names the user", async () => {
    mockAuth = { token: "tok", displayName: "Ala" };
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "＋ Zapisz się na zajęcia" }));

    const dialog = await screen.findByRole("dialog", { name: "Zapisz się na zajęcia" });
    expect(within(dialog).getByText(/Zapisujesz się jako/)).toHaveTextContent("Zapisujesz się jako Ala");
  });

  it("a PRIVATE group member sees the full term view with no guest or gate actions", async () => {
    mockAuth = { token: "tok", displayName: "Ala" };
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(
      access({ group: { visibility: "PRIVATE" }, access: { is_member: true } }),
    );
    renderPage();

    expect(await screen.findByText("Zajęcia w parku")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Zapisani na zajęcia" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "＋ Zapisz się na zajęcia" })).toBeInTheDocument();
    expect(screen.queryByText(/Ta grupa jest prywatna/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mam kod dostępu" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Zaloguj się, żeby się zapisać" })).not.toBeInTheDocument();
  });

  it("the needed-items and attendee sections are named regions", async () => {
    renderPage();

    const needed = await screen.findByRole("region", { name: "Potrzebne rzeczy" });
    expect(within(needed).getByText("Bębenek")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Zapisani na zajęcia" })).toBeInTheDocument();
  });
});

describe("TermPage — direct sign-up and server error messages", () => {
  it("logged in with children in the family: signs up straight away with that child count, no dialog", async () => {
    mockAuth = { token: "tok", displayName: "Ala" };
    vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([
      { id: "3", party_id: "4", name: "Kowalscy", child_count: 2, created_at: "", updated_at: "" },
    ]);
    vi.mocked(groupsApi.createRsvp).mockResolvedValue({ attached_to_account: true } as never);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "＋ Zapisz się na zajęcia" }));

    await waitFor(() =>
      expect(groupsApi.createRsvp).toHaveBeenCalledWith("7", { term_id: "101", guardian_name: "Ala", child_count: 2 }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Zapisano na zajęcia z 2 dziećmi");
    expect(screen.queryByRole("dialog", { name: "Zapisz się na zajęcia" })).not.toBeInTheDocument();
  });

  it("direct sign-up rejected with 409 shows the server's message", async () => {
    mockAuth = { token: "tok", displayName: "Ala" };
    vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([
      { id: "3", party_id: "4", name: "Kowalscy", child_count: 1, created_at: "", updated_at: "" },
    ]);
    vi.mocked(groupsApi.createRsvp).mockRejectedValue(
      new ApiError(409, "Conflict", { message: "Termin już się odbył" }),
    );
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "＋ Zapisz się na zajęcia" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Termin już się odbył");
  });

  it("a 403 on 'Ja to przyniosę' explains the missing permission instead of a generic failure", async () => {
    mockAuth = { token: "tok", displayName: "Ala" };
    vi.mocked(pledgesApi.createPledge).mockRejectedValue(
      new ApiError(403, "Forbidden", { message: "Access denied" }),
    );
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Ja to przyniosę: Bębenek" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Nie masz uprawnień do tej akcji");
  });

  it("a 409 on 'Weź na stałe' shows the server's reason", async () => {
    mockAuth = { token: "tok", displayName: "Ala" };
    vi.mocked(termItemListingsApi.takeTermItemListing).mockRejectedValue(
      new ApiError(409, "Conflict", { message: "Ta rzecz jest już zajęta" }),
    );
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Weź na stałe: Rowerek" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Ta rzecz jest już zajęta");
  });
});

describe("TermPage — organizer theme fallback", () => {
  it("an accent-only organizer renders the term view in the default palette", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(
      access({ group: { organization: { name: "Pomaranczowe Nutki", primary_color: null, accent_color: "#f39c12", palette_preset: null } } }),
    );
    renderPage();

    const heading = await screen.findByRole("heading", { level: 1, name: "Muzyczne Skrzaty" });
    expect(heading.closest("[data-organizer-theme]")).toHaveAttribute("data-organizer-theme", "default");
  });
});
