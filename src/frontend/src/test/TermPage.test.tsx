import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TermPage } from "../pages/krag/TermPage";
import * as groupsApi from "../api/groups";
import * as pledgesApi from "../api/pledges";
import * as termItemListingsApi from "../api/termItemListings";
import type { GroupAccessResponse, PublicCircleResponse } from "../api/groups";

vi.mock("../api/groups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/groups")>();
  return { ...actual, getGroupAccess: vi.fn(), createRsvp: vi.fn(), mergeAnonymousProfile: vi.fn() };
});
vi.mock("../api/pledges", () => ({ createPledge: vi.fn() }));
vi.mock("../api/termItemListings", () => ({ takeTermItemListing: vi.fn(), proposeSwap: vi.fn() }));

let mockAuth: { token: string | null; displayName: string | null };

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ ...mockAuth, applyExternalToken: vi.fn() }),
}));

const PATH = "/zajecia/grupa/7/term/101";
const GUEST_KEY = groupsApi.guestProfileIdKey(7, 101);

const circle: PublicCircleResponse = {
  id: 7,
  name: "Muzyczne Skrzaty",
  organizer_display_name: "Ania Kowalska",
  organizer_slug: "ania",
  visibility: "PUBLIC",
  layout_mode: "CIRCLE",
  next_term: {
    id: 101,
    occurs_on: "2026-10-01T17:00:00",
    description: "Zajęcia w parku",
    needed_items: [
      {
        id: 11,
        product_id: 1,
        product_name: "Bębenek",
        product_category_id: 5,
        product_category_name: "Inne",
        description: null,
        claimed: false,
        claimed_by_name: null,
        claimed_by_party_id: null,
      },
    ],
    item_listings: [
      {
        id: 9,
        item_id: 9,
        product_name: "Rowerek",
        condition: "GOOD",
        offered_types: ["LEND"],
        lister_party_id: 21,
        lister_display_name: "Ola Nowak",
      },
      {
        id: 10,
        item_id: 10,
        product_name: "Namiot",
        condition: "GOOD",
        offered_types: ["GIFT"],
        lister_party_id: 99,
        lister_display_name: "Ania Kowalska",
      },
    ],
  },
  guardians: [
    { party_id: 21, display_name: "Ola Nowak" },
    { party_id: 22, display_name: "Piotr Zieliński" },
  ],
};

function access(
  overrides: { group?: Partial<PublicCircleResponse>; access?: Partial<GroupAccessResponse["access"]> } = {},
): GroupAccessResponse {
  return {
    group: { ...circle, ...overrides.group },
    access: {
      is_member: false,
      is_organizer: false,
      can_view_content: true,
      can_join: false,
      is_attending: false,
      ...overrides.access,
    },
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[PATH]}>
      <Routes>
        <Route path="/:organizationSlug/grupa/:groupId/term/:termId" element={<TermPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  mockAuth = { token: null, displayName: null };
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(access());
});

describe("TermPage — header and content", () => {
  it("shows the group name with the term description as the header subtitle", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { level: 1, name: "Muzyczne Skrzaty" })).toBeInTheDocument();
    expect(screen.getByText("Zajęcia w parku")).toBeInTheDocument();
    expect(groupsApi.getGroupAccess).toHaveBeenCalledWith(7, 101);
  });

  it("renders no subtitle when the term has no description", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(
      access({ group: { next_term: { ...circle.next_term!, description: null } } }),
    );
    const { container } = renderPage();

    await screen.findByRole("heading", { level: 1, name: "Muzyczne Skrzaty" });
    expect(container.querySelector(".kg-head-sub")).toBeNull();
  });

  it("draws signed-up people in the group's layout, with the shares/brings markers", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(
      access({
        group: {
          layout_mode: "TABLE",
          next_term: {
            ...circle.next_term!,
            needed_items: [{ ...circle.next_term!.needed_items[0], claimed: true, claimed_by_party_id: 22 }],
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
    expect(entry).toHaveClass("is-on");
  });

  it("lists every attendee with their own offered items, plus non-attending listers", async () => {
    renderPage();

    const list = await screen.findByRole("region", { name: "Zapisani na zajęcia" });
    const ola = document.getElementById("attendee-21")!;
    expect(within(ola).getByText("Rowerek")).toBeInTheDocument();
    expect(within(ola).getByRole("button", { name: "Pożycz: Rowerek" })).toBeInTheDocument();
    expect(within(document.getElementById("attendee-22")!).queryAllByRole("button")).toHaveLength(0);
    expect(within(list).getByText("Ania Kowalska")).toBeInTheDocument();
    expect(within(document.getElementById("attendee-99")!).getByText("Namiot")).toBeInTheDocument();
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

    expect(screen.getByRole("dialog", { name: "Zapisz się na zajęcia" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Imię")).not.toBeInTheDocument();
  });

  it("logged in and attending: no sign-up button", async () => {
    mockAuth = { token: "tok", displayName: "Ala" };
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(access({ access: { is_attending: true } }));
    renderPage();

    await screen.findByRole("heading", { level: 1, name: "Muzyczne Skrzaty" });
    expect(screen.queryByRole("button", { name: /Zapisz się/ })).not.toBeInTheDocument();
  });

  it("a guest who already RSVP'd sees no sign-up button and gets the account form instead of the gate", async () => {
    groupsApi.writeGuestProfile(GUEST_KEY, 55);
    renderPage();

    await screen.findByRole("heading", { level: 1, name: "Muzyczne Skrzaty" });
    expect(screen.queryByRole("button", { name: /Zapisz się|żeby się zapisać/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ja to przyniosę: Bębenek" }));

    expect(screen.getByRole("form", { name: /Załóż konto/ })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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

    await waitFor(() => expect(pledgesApi.createPledge).toHaveBeenCalledWith(11));
    expect(await screen.findByText("Przynosi: Ty")).toBeInTheDocument();
  });

  it("logged in 'Pożycz' takes the item for the shown term", async () => {
    mockAuth = { token: "tok", displayName: "Ala" };
    vi.mocked(termItemListingsApi.takeTermItemListing).mockResolvedValue({} as never);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Pożycz: Rowerek" }));

    await waitFor(() =>
      expect(termItemListingsApi.takeTermItemListing).toHaveBeenCalledWith(9, {
        term_id: 101,
        reservation_type: "LEND",
      }),
    );
  });
});

describe("TermPage — access", () => {
  it("a PRIVATE group shows only the 'grupa jest prywatna' card, no term content", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(
      access({ group: { visibility: "PRIVATE", next_term: null, guardians: [] }, access: { can_join: true } }),
    );
    renderPage();

    expect(await screen.findByText(/grupa jest prywatna/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zaloguj się" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Zapisani na zajęcia" })).not.toBeInTheDocument();
  });

  it("an unknown group or term shows 'Nie znaleziono'", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockRejectedValue(new Error("404"));
    renderPage();

    expect(await screen.findByText("Nie znaleziono")).toBeInTheDocument();
  });
});
