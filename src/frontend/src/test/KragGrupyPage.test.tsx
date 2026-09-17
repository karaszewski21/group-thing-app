import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { NeededItemResponse } from "../api/terms";
import type { PledgeResponse } from "../api/pledges";
import type { MyAttendanceResponse } from "../api/groups";
import type { BrowseTermItemListingResponse } from "../api/termItemListings";
import type { ReservationResponse } from "../api/reservations";
import type { UseKragGrupyResult } from "../hooks/useKragGrupy";
import { ApiError } from "../api/client";
import { KragGrupyPage } from "../pages/krag/KragGrupyPage";
import * as reservationsApi from "../api/reservations";

const fulfillPledgeItem = vi.fn();

let hookValue: UseKragGrupyResult;

vi.mock("../hooks/useKragGrupy", () => ({
  useKragGrupy: () => hookValue,
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

// KragGrupyPage fetches Reservation status directly (getReservation) to
// derive the listing status line / "Potwierdź odbiór" gating — mocked so no
// real network call happens; none of the fixtures below set
// resolved_reservation_id, so it's never actually invoked.
vi.mock("../api/reservations", () => ({
  getReservation: vi.fn(),
}));

const neededItem: NeededItemResponse = {
  id: 11,
  term_id: 1,
  product_id: 5,
  product_name: "Bębenek",
  product_category_id: 5,
  product_category_name: "Inne",
  description: "mały",
  claimed: false,
  created_at: "",
  updated_at: "",
};

const myClaimedPledge: PledgeResponse = {
  id: 91,
  needed_item_id: 11,
  pledged_by_party_id: 42,
  status: "CLAIMED",
  resolved_reservation_id: null,
  created_at: "",
  updated_at: "",
};

const attendanceRow: MyAttendanceResponse = {
  attendance_id: 1,
  term_id: 1,
  occurs_on: "2026-03-10",
  child_count: 1,
  group_id: 1,
  group_name: "Grupa Nutki",
  organizer_display_name: "Ola",
  organizer_slug: "grupa-nutki",
};

function browseListing(
  overrides: Partial<BrowseTermItemListingResponse> = {},
): BrowseTermItemListingResponse {
  return {
    id: 501,
    term_id: 1,
    item_id: 9,
    lister_party_id: 7,
    offered_types: ["LEND"],
    resolved_reservation_id: null,
    taken_by_party_id: null,
    product_name: "Rowerek",
    condition: "GOOD",
    lister_display_name: "Ola",
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function reservation(overrides: Partial<ReservationResponse> = {}): ReservationResponse {
  return {
    id: 900,
    item_id: 9,
    reservation_type: "LEND",
    reserved_by_user_id: 42,
    paired_reservation_id: null,
    reserved_at: "",
    expires_at: null,
    status: "PENDING",
    notes: null,
    ...overrides,
  };
}

function baseHookValue(overrides: Partial<UseKragGrupyResult> = {}): UseKragGrupyResult {
  return {
    loading: false,
    error: null,
    group: { id: 1, name: "Grupa Nutki", organizer_party_id: 7 } as never,
    organizer: { party_id: 7, display_name: "Ola" } as never,
    families: [],
    myPartyId: 42,
    currentTerm: { id: 1, circle_group_id: 1, occurs_on: "2026-03-10", description: null } as never,
    neededItems: [{ item: neededItem, pledges: [myClaimedPledge] }],
    myAvailableItems: [],
    myAttendanceForCurrentTerm: null,
    myItemListings: [],
    browseListings: [],
    pledgeFamilyName: () => "Rodzina Testowa",
    pledge: vi.fn(),
    withdraw: vi.fn(),
    fulfillPledgeItem,
    confirmPledgeReceipt: vi.fn(),
    takeListing: vi.fn(),
    proposeSwap: vi.fn(),
    withdrawMyAttendance: vi.fn(),
    confirmListingReceipt: vi.fn(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/krag/1"]}>
      <Routes>
        <Route path="/krag/:groupId" element={<KragGrupyPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hookValue = baseHookValue();
});

describe("KragGrupyPage (private view) — fulfill a pledge", () => {
  it("shows the needed item by its product_name", () => {
    renderPage();
    expect(screen.getByText(/Bębenek/)).toBeInTheDocument();
  });

  it("with no AVAILABLE items: 'nowa rzecz' mode, 'Z moich rzeczy' disabled, Zapisz → fulfillPledge({condition})", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Zarejestruj przedmiot" }));

    expect(screen.getByRole("button", { name: "Z moich rzeczy" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Nowa rzecz" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("Stan")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    await waitFor(() =>
      expect(fulfillPledgeItem).toHaveBeenCalledWith(91, { condition: "GOOD" }),
    );
  });

  it("a pledge that 409s shows the 'ktoś już' toast and refetches", async () => {
    const pledge = vi
      .fn()
      .mockRejectedValue(
        new ApiError(409, "Conflict", {
          message: "Ktoś już zadeklarował przyniesienie tej rzeczy",
        }),
      );
    const refetch = vi.fn();
    hookValue = baseHookValue({
      myPartyId: 99, // not the pledger → "Ja to przyniosę" toggle is shown
      neededItems: [{ item: neededItem, pledges: [] }],
      pledge,
      refetch,
    });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Ja to przyniosę: Bębenek" }));

    expect(
      await screen.findByText("Ktoś już zadeklarował przyniesienie tej rzeczy"),
    ).toBeInTheDocument();
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it("with an AVAILABLE item: defaults to 'z moich rzeczy', Zapisz → fulfillPledge({inventory_item_id})", async () => {
    hookValue = baseHookValue({
      myAvailableItems: [{ id: 500, productName: "Mój bębenek" }],
    });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Zarejestruj przedmiot" }));

    expect(screen.getByRole("button", { name: "Z moich rzeczy" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("Rzecz z moich zbiorów")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    await waitFor(() =>
      expect(fulfillPledgeItem).toHaveBeenCalledWith(91, { inventory_item_id: 500 }),
    );
  });
});

describe("KragGrupyPage (private view) — lending exchange mechanism", () => {
  it("the exchange card is not rendered for a non-attendee, non-organizer viewer", () => {
    hookValue = baseHookValue({ myAttendanceForCurrentTerm: null });
    renderPage();

    expect(screen.queryByText("Twoje wystawione rzeczy")).not.toBeInTheDocument();
    expect(screen.queryByText("Rzeczy od innych")).not.toBeInTheDocument();
  });

  it("renders 'Twoje wystawione rzeczy' and 'Rzeczy od innych' sections when attendance is present", () => {
    hookValue = baseHookValue({ myAttendanceForCurrentTerm: attendanceRow });
    renderPage();

    expect(screen.getByText("Twoje wystawione rzeczy")).toBeInTheDocument();
    expect(screen.getByText("Rzeczy od innych")).toBeInTheDocument();
  });

  it("renders the exchange card for the Circle organizer even without a TermAttendance row", () => {
    hookValue = baseHookValue({
      myPartyId: 7, // matches `organizer.party_id` from baseHookValue()
      myAttendanceForCurrentTerm: null,
    });
    renderPage();

    expect(screen.getByText("Twoje wystawione rzeczy")).toBeInTheDocument();
    expect(screen.getByText("Rzeczy od innych")).toBeInTheDocument();
  });

  it("an empty 'Twoje wystawione rzeczy' hints at setting the mode in Moje rzeczy instead of offering an in-page form", () => {
    hookValue = baseHookValue({ myAttendanceForCurrentTerm: attendanceRow, myItemListings: [] });
    renderPage();

    expect(screen.getByText(/Ustaw tryb rzeczy w/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Moje rzeczy" })).toHaveAttribute(
      "href",
      "/panel/rzeczy",
    );
    expect(screen.queryByRole("button", { name: "+ Wystaw rzecz" })).not.toBeInTheDocument();
  });

  it("each browseListings row renders one button per still-available offered type only (not RETURN, not un-offered)", () => {
    hookValue = baseHookValue({
      myAttendanceForCurrentTerm: attendanceRow,
      browseListings: [browseListing({ offered_types: ["LEND", "SWAP"] })],
    });
    renderPage();

    expect(screen.getByRole("button", { name: "Pożycz: Rowerek" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zamień: Rowerek" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Weź na stałe: Rowerek" })).not.toBeInTheDocument();
    expect(screen.queryByText("Zwrot")).not.toBeInTheDocument();
  });

  it("clicking a SWAP button reveals the taker's own myAvailableItems <select> and proposes (not takes) the swap on submit", async () => {
    // Group 7: SWAP no longer goes through `takeListing` at all — the
    // backend now rejects a SWAP take outright (see
    // `TakeTermItemListingRequest`'s docstring) — it's always a proposal
    // via the hook's dedicated `proposeSwap`, which the listing owner must
    // separately accept/reject.
    const takeListing = vi.fn().mockResolvedValue(undefined);
    const proposeSwap = vi.fn().mockResolvedValue(undefined);
    hookValue = baseHookValue({
      myAttendanceForCurrentTerm: attendanceRow,
      myAvailableItems: [{ id: 900, productName: "Mój rowerek" }],
      browseListings: [browseListing({ offered_types: ["SWAP"] })],
      takeListing,
      proposeSwap,
    });
    renderPage();

    expect(screen.queryByLabelText("Twoja rzecz do zamiany")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Zamień: Rowerek" }));

    expect(screen.getByLabelText("Twoja rzecz do zamiany")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Zaproponuj zamianę" }));

    await waitFor(() => expect(proposeSwap).toHaveBeenCalledWith(501, 900));
    expect(takeListing).not.toHaveBeenCalled();
  });

  it("'Wycofaj się z zajęć' calls withdrawMyAttendance() and the card disappears on success", async () => {
    const withdrawMyAttendance = vi.fn().mockResolvedValue(undefined);
    hookValue = baseHookValue({
      myAttendanceForCurrentTerm: attendanceRow,
      withdrawMyAttendance,
    });
    const { rerender } = renderPage();

    expect(screen.getByText("Twoje wystawione rzeczy")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Wycofaj się z zajęć" }));

    await waitFor(() => expect(withdrawMyAttendance).toHaveBeenCalled());

    // Mirrors Task Group 2's server-side filter: once withdrawn, the hook's
    // next state has myAttendanceForCurrentTerm back to null — re-render with
    // that state and confirm the whole card disappears.
    hookValue = baseHookValue({ myAttendanceForCurrentTerm: null });
    rerender(
      <MemoryRouter initialEntries={["/krag/1"]}>
        <Routes>
          <Route path="/krag/:groupId" element={<KragGrupyPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByText("Twoje wystawione rzeczy")).not.toBeInTheDocument();
  });

  // Group 5's implementer deviated from spec.md's literal "status === CONFIRMED"
  // gate for "Potwierdź odbiór", reasoning that nothing ever transitions a
  // listing's Reservation PENDING -> CONFIRMED ahead of confirmListingReceipt()
  // itself (which performs confirm+fulfill together), so a CONFIRMED-only gate
  // would make the button permanently unreachable. This proves the actual
  // gating in confirmActionFor() — "not yet FULFILLED/CANCELLED" — is correct:
  // the button is reachable at PENDING (the real starting state a taken
  // listing's reservation is in) and disappears once FULFILLED.
  it("'Potwierdź odbiór' is reachable while the reservation is PENDING, and disappears once FULFILLED", async () => {
    vi.mocked(reservationsApi.getReservation).mockImplementation((id: number) =>
      Promise.resolve(
        id === 900
          ? reservation({ id: 900, status: "PENDING" })
          : reservation({ id: 901, item_id: 10, status: "FULFILLED" }),
      ),
    );
    hookValue = baseHookValue({
      myAttendanceForCurrentTerm: attendanceRow,
      browseListings: [
        browseListing({
          id: 501,
          item_id: 9,
          product_name: "Rowerek pożyczony",
          resolved_reservation_id: 900,
          taken_by_party_id: 42, // myPartyId — viewer is the receiving taker
        }),
        browseListing({
          id: 502,
          item_id: 10,
          product_name: "Sanki oddane",
          resolved_reservation_id: 901,
          taken_by_party_id: 42,
        }),
      ],
    });
    renderPage();

    // Reachable at PENDING — this is the only status a freshly-taken
    // listing's reservation is ever actually in when the taker sees it.
    const pendingRow = screen.getByText("Rowerek pożyczony").closest(".kg-bring-item") as HTMLElement;
    await waitFor(() =>
      expect(within(pendingRow).getByRole("button", { name: "Potwierdź odbiór" })).toBeInTheDocument(),
    );

    // Same fetch batch resolved the FULFILLED row too — safe to assert its
    // button is absent now that the PENDING row's has been confirmed present.
    const fulfilledRow = screen.getByText("Sanki oddane").closest(".kg-bring-item") as HTMLElement;
    expect(within(fulfilledRow).queryByRole("button", { name: "Potwierdź odbiór" })).not.toBeInTheDocument();

    expect(screen.getAllByRole("button", { name: "Potwierdź odbiór" })).toHaveLength(1);
  });
});
