import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { NeededItemResponse } from "../api/terms";
import type { PledgeResponse } from "../api/pledges";
import type { FamilyExchangeOffer, MyAttendanceResponse } from "../api/groups";
import type { BrowseTermItemListingResponse } from "../api/termItemListings";
import type { ReservationResponse } from "../api/reservations";
import type { UseKragGrupyResult } from "../hooks/useKragGrupy";
import type { TermAttendeeResponse } from "../api/groups";
import { ApiError } from "../api/client";
import { TermPage } from "../pages/krag/TermPage";
import * as reservationsApi from "../api/reservations";
import * as termItemListingsApi from "../api/termItemListings";
import * as groupsApi from "../api/groups";
import * as familiesApi from "../api/families";

// `PrivateTermView`'s "Zapisz się na zajęcia" sign-up path (regression
// fix: any logged-in visitor previously had no way to RSVP to a new term on
// this view at all) renders `RsvpDialogLoggedIn`, which calls these real
// API modules directly (not through the mocked `useKragGrupy` hook).
// `TermAccessBoundary` (TermPage.tsx) resolves access before rendering the
// private/member view this whole file exercises — default to
// "member, can view" so every existing test (none of which cares about the
// boundary itself; that's TermPageRouting.test.tsx's job) reaches
// `PrivateTermView` without per-test setup. `vi.clearAllMocks()` below
// clears call history but not this resolved value (unlike
// `vi.resetAllMocks()` elsewhere), so it survives across tests in this file.
vi.mock("../api/groups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/groups")>();
  return {
    ...actual,
    createRsvp: vi.fn(),
    getGroupAccess: vi.fn().mockResolvedValue({
      group: {
        id: 1,
        name: "Grupa Nutki",
        organizer_display_name: "Ola",
        organizer_slug: "ola",
        visibility: "PUBLIC",
        next_term: null,
        guardians: [],
      },
      access: { is_member: true, is_organizer: false, can_view_content: true, can_join: false },
    }),
  };
});

vi.mock("../api/families", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/families")>();
  return { ...actual, getMyFamilies: vi.fn() };
});

const fulfillPledgeItem = vi.fn();

let hookValue: UseKragGrupyResult;

vi.mock("../hooks/useKragGrupy", () => ({
  useKragGrupy: () => hookValue,
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

// `TermPage` (the merged route element) branches on `token` to decide
// Private vs Public view — this file only exercises the Private view, so a
// token is always present here (see the separate "merged routing" describe
// block below for the branch itself, and PublicTermPage.test.tsx for
// the no-token branch).
vi.mock("../auth/AuthContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth/AuthContext")>();
  return {
    ...actual,
    useAuth: () => ({
      token: "test-token",
      username: null,
      displayName: "Ty",
      permissions: [],
      registeredRole: null,
      login: vi.fn(),
      register: vi.fn(),
      applyExternalToken: vi.fn(),
      logout: vi.fn(),
    }),
  };
});

// TermPage fetches Reservation status directly (getReservation) to
// derive the listing status line / "Potwierdź odbiór" gating — mocked so no
// real network call happens; none of the fixtures below set
// resolved_reservation_id, so it's never actually invoked.
vi.mock("../api/reservations", () => ({
  getReservation: vi.fn(),
}));

// Group 4 (2026-09-17-fix-giveaway-exchange): TermPage now also fetches
// the caller's own taken listings directly (getMyTakenTermItemListings,
// availability-independent unlike the mocked useKragGrupy's browseListings)
// to keep a taken-but-unconfirmed row's confirm button rendering after the
// term has occurred. Mocked to resolve empty by default so no real network
// call happens; individual tests override it when they need a merged row.
vi.mock("../api/termItemListings", () => ({
  getMyTakenTermItemListings: vi.fn().mockResolvedValue([]),
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

// myPartyId defaults to 42 in baseHookValue() — ownFamily's guardian matches
// it (so the card's exchange section must never render for it); otherFamily
// has no overlap with 42.
const ownFamily = {
  familyId: 1,
  name: "Rodzina Testowa",
  guardians: [{ party_id: 42, display_name: "Ty" }] as never,
  sharesItem: false,
  bringsItem: false,
};
const otherFamily = {
  familyId: 2,
  name: "Rodzina Wiśniewskich",
  guardians: [{ party_id: 8, display_name: "Ola Wiśniewska" }] as never,
  sharesItem: true,
  bringsItem: false,
};

function exchangeOffer(overrides: Partial<FamilyExchangeOffer> = {}): FamilyExchangeOffer {
  return {
    id: 701,
    item_id: 20,
    product_name: "Książka: Pucio",
    condition: "GOOD",
    offered_types: ["LEND"],
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
    group: { id: 1, name: "Grupa Nutki", organizer_party_id: 7, layout_mode: "CIRCLE" } as never,
    organizer: { party_id: 7, display_name: "Ola" } as never,
    families: [],
    myPartyId: 42,
    currentTerm: { id: 1, circle_group_id: 1, occurs_on: "2026-03-10", description: null } as never,
    neededItems: [{ item: neededItem, pledges: [myClaimedPledge] }],
    myAvailableItems: [],
    mySwapAvailableItems: [],
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
    activeFamilyExchangeOffers: [],
    loadingExchangeOffers: false,
    exchangeOffersError: null,
    loadExchangeOffersForFamily: vi.fn(),
    setGroupLayoutMode: vi.fn(),
    takeOrProposeExchange: vi.fn(),
    termAttendeesForFormalization: null,
    formalizeStandingMembers: vi.fn(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function termAttendee(overrides: Partial<TermAttendeeResponse> = {}): TermAttendeeResponse {
  return {
    party_id: 7,
    display_name: "Kasia Nowak",
    child_count: 1,
    family_id: 10,
    family_name: "Rodzina Nowak",
    already_member: false,
    ...overrides,
  };
}

async function renderPage() {
  const utils = render(
    <MemoryRouter initialEntries={["/org/grupa/1/term/9"]}>
      <Routes>
        <Route path="/:organizationSlug/grupa/:groupId/term/:termId" element={<TermPage />} />
      </Routes>
    </MemoryRouter>,
  );
  // `TermAccessBoundary` resolves `getGroupAccess` before rendering
  // `PrivateTermView` — wait for that resolution so every test below can
  // keep using synchronous `getBy*` queries after `await renderPage()`.
  await waitFor(() => expect(screen.queryByText("Wczytywanie...")).not.toBeInTheDocument());
  // `PrivateTermView`'s own mount-time effects (e.g. the standing-member
  // pre-selection effect) are scheduled as passive effects on the tick after
  // the boundary's loading state clears — flush once more so callers can
  // rely on synchronous `getBy*` queries immediately after this resolves.
  await act(async () => {});
  return utils;
}

beforeEach(() => {
  vi.clearAllMocks();
  hookValue = baseHookValue();
  // clearAllMocks() clears call history but not a mockResolvedValue set by a
  // prior test — reset explicitly so tests overriding this stay isolated
  // from each other (Group 6: the cross-surface-consistency test overrides
  // this mock, and without this reset a later test could pick up its
  // leftover value and see a stray merged row).
  vi.mocked(termItemListingsApi.getMyTakenTermItemListings).mockResolvedValue([]);
  vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([]);
});

describe("TermPage (private view) — fulfill a pledge", () => {
  it("shows the needed item by its product_name", async () => {
    await renderPage();
    expect(screen.getByText(/Bębenek/)).toBeInTheDocument();
  });

  it("with no AVAILABLE items: 'nowa rzecz' mode, 'Z moich rzeczy' disabled, Zapisz → fulfillPledge({condition})", async () => {
    await renderPage();

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
    await renderPage();

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
    await renderPage();

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

describe("TermPage (private view) — lending exchange mechanism", () => {
  it("the exchange card is not rendered for a non-attendee, non-organizer viewer", async () => {
    hookValue = baseHookValue({ myAttendanceForCurrentTerm: null });
    await renderPage();

    expect(screen.queryByText("Twoje wystawione rzeczy")).not.toBeInTheDocument();
    expect(screen.queryByText("Rzeczy od innych")).not.toBeInTheDocument();
  });

  it("renders 'Twoje wystawione rzeczy' and 'Rzeczy od innych' sections when attendance is present", async () => {
    hookValue = baseHookValue({ myAttendanceForCurrentTerm: attendanceRow });
    await renderPage();

    expect(screen.getByText("Twoje wystawione rzeczy")).toBeInTheDocument();
    expect(screen.getByText("Rzeczy od innych")).toBeInTheDocument();
  });

  it("renders the exchange card for the Circle organizer even without a TermAttendance row", async () => {
    hookValue = baseHookValue({
      myPartyId: 7, // matches `organizer.party_id` from baseHookValue()
      myAttendanceForCurrentTerm: null,
    });
    await renderPage();

    expect(screen.getByText("Twoje wystawione rzeczy")).toBeInTheDocument();
    expect(screen.getByText("Rzeczy od innych")).toBeInTheDocument();
  });

  it("an empty 'Twoje wystawione rzeczy' hints at setting the mode in Moje rzeczy instead of offering an in-page form", async () => {
    hookValue = baseHookValue({ myAttendanceForCurrentTerm: attendanceRow, myItemListings: [] });
    await renderPage();

    expect(screen.getByText(/Ustaw tryb rzeczy w/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Moje rzeczy" })).toHaveAttribute(
      "href",
      "/panel/rzeczy",
    );
    expect(screen.queryByRole("button", { name: "+ Wystaw rzecz" })).not.toBeInTheDocument();
  });

  it("each browseListings row renders one button per still-available offered type only (not RETURN, not un-offered)", async () => {
    hookValue = baseHookValue({
      myAttendanceForCurrentTerm: attendanceRow,
      browseListings: [browseListing({ offered_types: ["LEND", "SWAP"] })],
    });
    await renderPage();

    expect(screen.getByRole("button", { name: "Pożycz: Rowerek" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zamień: Rowerek" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Weź na stałe: Rowerek" })).not.toBeInTheDocument();
    expect(screen.queryByText("Zwrot")).not.toBeInTheDocument();
  });

  it("clicking a SWAP button reveals the taker's own mySwapAvailableItems <select> and proposes (not takes) the swap on submit", async () => {
    // Group 8: both "Rzeczy od innych" and the family-card exchange section
    // now route SWAP through the hook's shared `takeOrProposeExchange`
    // (Group 7) instead of a dedicated `proposeSwap` call site.
    const takeOrProposeExchange = vi.fn().mockResolvedValue(undefined);
    hookValue = baseHookValue({
      myAttendanceForCurrentTerm: attendanceRow,
      mySwapAvailableItems: [{ id: 900, productName: "Mój rowerek" }],
      browseListings: [browseListing({ offered_types: ["SWAP"] })],
      takeOrProposeExchange,
    });
    await renderPage();

    expect(screen.queryByLabelText("Twoja rzecz do zamiany")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Zamień: Rowerek" }));

    expect(screen.getByLabelText("Twoja rzecz do zamiany")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Zaproponuj zamianę" }));

    await waitFor(() => expect(takeOrProposeExchange).toHaveBeenCalledWith(501, "SWAP", 900));
  });

  // Group 5 — the picker only ever receives already-SWAP-filtered items from
  // the hook (`mySwapAvailableItems`), so when that array is empty it must
  // show an inline empty-state message instead of a bare, optionless <select>.
  it("SwapProposeDialog renders the kg-bring-sub empty-state message when mySwapAvailableItems is empty", async () => {
    hookValue = baseHookValue({
      myAttendanceForCurrentTerm: attendanceRow,
      mySwapAvailableItems: [],
      browseListings: [browseListing({ offered_types: ["SWAP"] })],
    });
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Zamień: Rowerek" }));

    expect(screen.queryByLabelText("Twoja rzecz do zamiany")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Nie masz żadnej rzeczy oznaczonej "zamienię"/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zaproponuj zamianę" })).toBeDisabled();
  });

  it("SwapProposeDialog renders the <select> + trade preview, preserving aria-label, when at least one SWAP-tagged item exists", async () => {
    hookValue = baseHookValue({
      myAttendanceForCurrentTerm: attendanceRow,
      mySwapAvailableItems: [{ id: 900, productName: "Mój rowerek" }],
      browseListings: [browseListing({ offered_types: ["SWAP"] })],
    });
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Zamień: Rowerek" }));

    expect(screen.getByLabelText("Twoja rzecz do zamiany")).toBeInTheDocument();
    expect(screen.getByText(/Twoja rzecz/)).toBeInTheDocument();
    expect(
      screen.queryByText(/Nie masz żadnej rzeczy oznaczonej "zamienię"/),
    ).not.toBeInTheDocument();
  });

  it("'Wycofaj się z zajęć' calls withdrawMyAttendance() and the card disappears on success", async () => {
    const withdrawMyAttendance = vi.fn().mockResolvedValue(undefined);
    hookValue = baseHookValue({
      myAttendanceForCurrentTerm: attendanceRow,
      withdrawMyAttendance,
    });
    const { rerender } = await renderPage();

    expect(screen.getByText("Twoje wystawione rzeczy")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Wycofaj się z zajęć" }));

    await waitFor(() => expect(withdrawMyAttendance).toHaveBeenCalled());

    // Mirrors Task Group 2's server-side filter: once withdrawn, the hook's
    // next state has myAttendanceForCurrentTerm back to null — re-render with
    // that state and confirm the whole card disappears.
    hookValue = baseHookValue({ myAttendanceForCurrentTerm: null });
    rerender(
      <MemoryRouter initialEntries={["/org/grupa/1/term/9"]}>
        <Routes>
          <Route path="/:organizationSlug/grupa/:groupId/term/:termId" element={<TermPage />} />
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
    await renderPage();

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

  // Group 3 — term-page confirm button wiring + term-end gating (Root Cause
  // A fix, ui-mockups.md Mockup 1): same button/position/label, but now
  // gated on the current Term having actually occurred, and wired to
  // confirmListingReceipt (which the hook implements via confirmTransaction,
  // never fulfillReservation — see useKragGrupy.test.ts for that guard).
  it("the confirm button renders disabled with a 'dostępne po zakończeniu zajęć' statusLine before the term has occurred", async () => {
    vi.mocked(reservationsApi.getReservation).mockResolvedValue(
      reservation({ id: 900, status: "PENDING" }),
    );
    hookValue = baseHookValue({
      myAttendanceForCurrentTerm: attendanceRow,
      currentTerm: { id: 1, circle_group_id: 1, occurs_on: "2099-01-01T00:00:00", description: null } as never,
      browseListings: [browseListing({ resolved_reservation_id: 900, taken_by_party_id: 42 })],
    });
    await renderPage();

    const button = await screen.findByRole("button", { name: "Potwierdź odbiór" });
    expect(button).toBeDisabled();
    expect(screen.getByText("dostępne po zakończeniu zajęć")).toBeInTheDocument();
  });

  it("the confirm button is enabled (no disabled attribute) once the term has occurred", async () => {
    vi.mocked(reservationsApi.getReservation).mockResolvedValue(
      reservation({ id: 900, status: "PENDING" }),
    );
    hookValue = baseHookValue({
      myAttendanceForCurrentTerm: attendanceRow,
      currentTerm: { id: 1, circle_group_id: 1, occurs_on: "2020-01-01T00:00:00", description: null } as never,
      browseListings: [browseListing({ resolved_reservation_id: 900, taken_by_party_id: 42 })],
    });
    await renderPage();

    const button = await screen.findByRole("button", { name: "Potwierdź odbiór" });
    expect(button).not.toBeDisabled();
  });

  it("clicking 'Potwierdź odbiór' after term-end calls confirmListingReceipt with the reservation id and the current term id", async () => {
    vi.mocked(reservationsApi.getReservation).mockResolvedValue(
      reservation({ id: 900, status: "PENDING" }),
    );
    const confirmListingReceipt = vi.fn().mockResolvedValue(undefined);
    hookValue = baseHookValue({
      myAttendanceForCurrentTerm: attendanceRow,
      currentTerm: { id: 1, circle_group_id: 1, occurs_on: "2020-01-01T00:00:00", description: null } as never,
      browseListings: [browseListing({ resolved_reservation_id: 900, taken_by_party_id: 42 })],
      confirmListingReceipt,
    });
    await renderPage();

    const button = await screen.findByRole("button", { name: "Potwierdź odbiór" });
    fireEvent.click(button);

    await waitFor(() => expect(confirmListingReceipt).toHaveBeenCalledWith(900, 1));
  });

  // Group 6 — cross-surface consistency (spec.md's Root Cause B): the term
  // page's effectiveBrowseListings/confirmActionFor and the global
  // pending-actions modal's resolvePendingReservationId
  // (PanelDataContext.tsx) both derive from the SAME
  // getMyTakenTermItemListings row for a taken GIFT listing. This test uses
  // the identical listing id (9) / reservation id (77) as
  // PanelPage.test.tsx's "resolves a GIFT reservation id for the taker even
  // when the term has already ended" test, so the two together demonstrate
  // both surfaces resolve to the same reservation id for the same
  // underlying data — not just independently to *some* id.
  it("term page resolves the same reservation id (77) for a taken GIFT listing that the global modal resolves for the identical fixture", async () => {
    vi.mocked(termItemListingsApi.getMyTakenTermItemListings).mockResolvedValue([
      browseListing({ id: 9, item_id: 9, resolved_reservation_id: 77, taken_by_party_id: 42 }),
    ]);
    vi.mocked(reservationsApi.getReservation).mockResolvedValue(
      reservation({ id: 77, item_id: 9, reservation_type: "GIFT", status: "PENDING" }),
    );
    const confirmListingReceipt = vi.fn().mockResolvedValue(undefined);
    hookValue = baseHookValue({
      myAttendanceForCurrentTerm: attendanceRow,
      currentTerm: { id: 1, circle_group_id: 1, occurs_on: "2020-01-01T00:00:00", description: null } as never,
      browseListings: [],
      confirmListingReceipt,
    });
    await renderPage();

    const button = await screen.findByRole("button", { name: "Potwierdź odbiór" });
    fireEvent.click(button);

    await waitFor(() => expect(confirmListingReceipt).toHaveBeenCalledWith(77, 1));
  });

  // Group 6 — regression guard against Root Cause A's premature-fulfillment
  // bug, specifically for the SWAP paired-leg (lister) branch of
  // confirmActionFor: the existing pre-term-end gating tests above only
  // exercise the generic taker branch (default LEND fixture); this proves
  // the lister's own paired-leg confirm button is *also* disabled before
  // the term has occurred, not just before the taker's.
  it("the SWAP paired-leg confirm button (lister side) is also disabled with the term-gate statusLine before the term has occurred", async () => {
    vi.mocked(reservationsApi.getReservation).mockImplementation((id: number) =>
      Promise.resolve(
        id === 900
          ? reservation({ id: 900, reservation_type: "SWAP", paired_reservation_id: 901, status: "CONFIRMED" })
          : reservation({ id: 901, reservation_type: "SWAP", status: "PENDING" }),
      ),
    );
    hookValue = baseHookValue({
      myAttendanceForCurrentTerm: attendanceRow,
      currentTerm: { id: 1, circle_group_id: 1, occurs_on: "2099-01-01T00:00:00", description: null } as never,
      myItemListings: [
        browseListing({
          id: 501,
          resolved_reservation_id: 900,
          lister_party_id: 42, // myPartyId — viewer is the listing owner/lister
          taken_by_party_id: 7,
        }),
      ],
    });
    await renderPage();

    const button = await screen.findByRole("button", { name: "Potwierdź odbiór" });
    expect(button).toBeDisabled();
    expect(screen.getByText("dostępne po zakończeniu zajęć")).toBeInTheDocument();
  });

  // Group 6 — GIFT/LEND owner/lister confirmation is intentionally NOT
  // surfaced as a term-page button (unlike SWAP's paired leg); it only
  // resolves via the global pending-actions modal's symmetric owner branch
  // (PanelDataContext.test coverage). Guards the two surfaces' "when is
  // this actionable" logic from silently drifting apart.
  it("a GIFT listing's owner/lister gets no term-page confirm button (only the global modal resolves that side)", async () => {
    vi.mocked(reservationsApi.getReservation).mockResolvedValue(
      reservation({ id: 900, reservation_type: "GIFT", paired_reservation_id: null, status: "PENDING" }),
    );
    hookValue = baseHookValue({
      myAttendanceForCurrentTerm: attendanceRow,
      myItemListings: [
        browseListing({
          id: 501,
          resolved_reservation_id: 900,
          lister_party_id: 42, // myPartyId — viewer is the listing owner/lister
          taken_by_party_id: 7,
          offered_types: ["GIFT"],
        }),
      ],
    });
    await renderPage();

    await waitFor(() => expect(reservationsApi.getReservation).toHaveBeenCalledWith(900));
    expect(screen.queryByRole("button", { name: "Potwierdź odbiór" })).not.toBeInTheDocument();
  });

  // Group 6 — defense-in-depth: if the frontend somehow still submits a
  // non-SWAP-tagged offered item (e.g. a stale mySwapAvailableItems cache),
  // the backend's 409 BusinessConflict (test_proposeSwap_offeredItemModeMismatch_raisesBusinessConflict)
  // must surface as a toast, not an unhandled crash.
  it("a rejected SWAP proposal (409, non-tagged item) shows the generic error toast instead of crashing", async () => {
    const takeOrProposeExchange = vi.fn().mockRejectedValue(
      new ApiError(409, "Conflict", { detail: "Ta rzecz nie jest oznaczona do zamiany" }),
    );
    hookValue = baseHookValue({
      myAttendanceForCurrentTerm: attendanceRow,
      mySwapAvailableItems: [{ id: 900, productName: "Mój rowerek" }],
      browseListings: [browseListing({ offered_types: ["SWAP"] })],
      takeOrProposeExchange,
    });
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Zamień: Rowerek" }));
    fireEvent.click(screen.getByRole("button", { name: "Zaproponuj zamianę" }));

    await waitFor(() => expect(takeOrProposeExchange).toHaveBeenCalledWith(501, "SWAP", 900));
    expect(await screen.findByText("Nie udało się zaproponować zamiany")).toBeInTheDocument();
  });
});

// Layout-mode switcher moved from this screen to the "Grupy" section of the
// Panel (group edit) — see PanelPage.test.tsx's "circle layout mode" describe
// block. TermPage now only reads `group.layout_mode` (via
// GroupVisualization's `layoutMode` prop), it no longer renders a switcher.
describe("TermPage (private view) — no layout switcher on this screen", () => {
  it("renders no layout-mode switcher, even for the organizer viewer", async () => {
    hookValue = baseHookValue({ myPartyId: 7 /* matches organizer.party_id */ });
    await renderPage();

    expect(screen.queryByTestId("layout-switcher")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Tryb wizualizacji grupy" })).not.toBeInTheDocument();
  });
});

// Group 8 — family card "DO WYMIANY W GRUPIE" section
// (`component:family-card-exchange-section`).
describe("TermPage (private view) — family card exchange section", () => {
  it("never renders for the viewer's own family, even with offers already loaded", async () => {
    hookValue = baseHookValue({
      families: [ownFamily as never],
      activeFamilyExchangeOffers: [exchangeOffer()],
    });
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: ownFamily.name }));

    expect(screen.queryByText("Do wymiany w grupie")).not.toBeInTheDocument();
  });

  it("does not render when the other family's offer list is empty", async () => {
    hookValue = baseHookValue({
      families: [otherFamily as never],
      activeFamilyExchangeOffers: [],
    });
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: otherFamily.name }));

    expect(screen.queryByText("Do wymiany w grupie")).not.toBeInTheDocument();
  });

  it("renders offer name + type tag + 'Biorę' for another family with active offers, and never a 'Napisz' button", async () => {
    hookValue = baseHookValue({
      families: [otherFamily as never],
      activeFamilyExchangeOffers: [exchangeOffer({ product_name: "Książka: Pucio", offered_types: ["LEND"] })],
    });
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: otherFamily.name }));

    expect(screen.getByText("Do wymiany w grupie")).toBeInTheDocument();
    expect(screen.getByText("Książka: Pucio")).toBeInTheDocument();
    expect(screen.getByText("Pożycz")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Biorę: Książka: Pucio" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Napisz/ })).not.toBeInTheDocument();
  });

  it("'Biorę' invokes the same shared takeOrProposeExchange function used by 'Rzeczy od innych'", async () => {
    const takeOrProposeExchange = vi.fn().mockResolvedValue(undefined);
    hookValue = baseHookValue({
      families: [otherFamily as never],
      activeFamilyExchangeOffers: [exchangeOffer({ id: 701, offered_types: ["GIFT"] })],
      takeOrProposeExchange,
    });
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: otherFamily.name }));
    fireEvent.click(screen.getByRole("button", { name: "Biorę: Książka: Pucio" }));

    await waitFor(() => expect(takeOrProposeExchange).toHaveBeenCalledWith(701, "GIFT", undefined));
  });

  it("clicking an avatar lazily loads that family's offers via loadExchangeOffersForFamily", async () => {
    const loadExchangeOffersForFamily = vi.fn();
    hookValue = baseHookValue({
      families: [otherFamily as never],
      loadExchangeOffersForFamily,
    });
    await renderPage();

    expect(loadExchangeOffersForFamily).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: otherFamily.name }));

    expect(loadExchangeOffersForFamily).toHaveBeenCalledWith(otherFamily.familyId);
  });
});

// Group 5 — "Dodaj stałych członków z tego terminu" card
// (`component:promote-members-card-collapsed` / `component:promote-members-checklist`).
describe("TermPage (private view) — promote standing members", () => {
  it("renders the card (title + summary line + primary submit button) for isOrganizerViewer && currentTerm", async () => {
    hookValue = baseHookValue({
      myPartyId: 7, // matches organizer.party_id from baseHookValue()
      termAttendeesForFormalization: [termAttendee()],
    });
    await renderPage();

    expect(screen.getByText("Dodaj stałych członków z tego terminu")).toBeInTheDocument();
    expect(screen.getByText(/nie są jeszcze stałymi członkami grupy/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dodaj stałych członków" })).toBeInTheDocument();
    expect(screen.queryByText(/prywatna/)).not.toBeInTheDocument();
  });

  it("does not render (or renders nothing actionable) when isOrganizerViewer is false", async () => {
    hookValue = baseHookValue({
      myPartyId: 42, // does not match organizer.party_id (7)
      termAttendeesForFormalization: [termAttendee()],
    });
    await renderPage();

    expect(screen.queryByText("Dodaj stałych członków z tego terminu")).not.toBeInTheDocument();
  });

  it("selecting attendees and submitting calls formalizeStandingMembers with the correct party_ids", async () => {
    const formalizeStandingMembers = vi.fn().mockResolvedValue(undefined);
    hookValue = baseHookValue({
      myPartyId: 7,
      termAttendeesForFormalization: [
        termAttendee({ party_id: 7, display_name: "Kasia Nowak" }),
        termAttendee({ party_id: 8, display_name: "Ala Kowalska", already_member: true }),
        termAttendee({ party_id: 9, display_name: "Tomek Wiśniewski", family_id: null, family_name: null }),
      ],
      formalizeStandingMembers,
    });
    await renderPage();

    // Pre-selected: every attendee with already_member === false, regardless
    // of family — the already_member row is disabled (never family-based).
    const kasiaCheckbox = screen.getByLabelText("Ustal Kasia Nowak jako stałego członka");
    const alaCheckbox = screen.getByLabelText("Ustal Ala Kowalska jako stałego członka");
    const tomekCheckbox = screen.getByLabelText("Ustal Tomek Wiśniewski jako stałego członka");
    expect(kasiaCheckbox).toBeChecked();
    expect(alaCheckbox).not.toBeChecked();
    expect(alaCheckbox).toBeDisabled();
    expect(tomekCheckbox).toBeChecked();
    expect(tomekCheckbox).not.toBeDisabled();

    // Deselect Tomek before submitting.
    fireEvent.click(tomekCheckbox);

    fireEvent.click(screen.getByRole("button", { name: "Dodaj stałych członków" }));

    await waitFor(() => expect(formalizeStandingMembers).toHaveBeenCalledWith([7]));
  });

  it("shows the nothing-to-promote state when every fetched attendee already_member === true", async () => {
    hookValue = baseHookValue({
      myPartyId: 7,
      termAttendeesForFormalization: [termAttendee({ already_member: true })],
    });
    await renderPage();

    expect(
      screen.getByText("Wszyscy zapisani na ten termin są już stałymi członkami grupy."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dodaj stałych członków" })).not.toBeInTheDocument();
  });

  it("shows the loading state while termAttendeesForFormalization is null", async () => {
    hookValue = baseHookValue({ myPartyId: 7, termAttendeesForFormalization: null });
    await renderPage();

    expect(screen.getByText("Wczytywanie zapisanych…")).toBeInTheDocument();
  });

  it("shows the success message after a successful submit", async () => {
    const formalizeStandingMembers = vi.fn().mockResolvedValue(undefined);
    hookValue = baseHookValue({
      myPartyId: 7,
      termAttendeesForFormalization: [termAttendee({ party_id: 7, display_name: "Kasia Nowak" })],
      formalizeStandingMembers,
    });
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Dodaj stałych członków" }));

    expect(
      await screen.findByText("Dodano 1 osobę jako stałych członków grupy."),
    ).toBeInTheDocument();
  });

  it("shows the inline error message when the submit fails", async () => {
    const formalizeStandingMembers = vi.fn().mockRejectedValue(new Error("boom"));
    hookValue = baseHookValue({
      myPartyId: 7,
      termAttendeesForFormalization: [termAttendee({ party_id: 7, display_name: "Kasia Nowak" })],
      formalizeStandingMembers,
    });
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Dodaj stałych członków" }));

    expect(
      await screen.findByText("Nie udało się dodać stałych członków — spróbuj ponownie"),
    ).toBeInTheDocument();
  });
});

// Regression coverage: `PrivateTermView` (any logged-in visitor, not
// just this circle's own members) previously had no way to RSVP to a new
// term at all — only to withdraw from one already joined. Verification-phase
// fix: a "Zapisz się na zajęcia" button + RsvpDialogLoggedIn now render when
// the group is PUBLIC and the viewer isn't yet attending the current term.
describe("TermPage (private view) — sign up for a PUBLIC group's term", () => {
  it("shows the sign-up button for a PUBLIC group with no existing attendance", async () => {
    hookValue = baseHookValue({
      group: { id: 1, name: "Grupa Nutki", organizer_party_id: 7, layout_mode: "CIRCLE", visibility: "PUBLIC" } as never,
      myAttendanceForCurrentTerm: null,
    });
    await renderPage();

    expect(screen.getByRole("button", { name: "＋ Zapisz się na zajęcia" })).toBeInTheDocument();
  });

  it("does not show the sign-up button once already attending", async () => {
    hookValue = baseHookValue({
      group: { id: 1, name: "Grupa Nutki", organizer_party_id: 7, layout_mode: "CIRCLE", visibility: "PUBLIC" } as never,
      myAttendanceForCurrentTerm: attendanceRow,
    });
    await renderPage();

    expect(
      screen.queryByRole("button", { name: "＋ Zapisz się na zajęcia" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wycofaj się z zajęć" })).toBeInTheDocument();
  });

  it("does not show the sign-up button for a PRIVATE group (join happens via standing membership instead)", async () => {
    hookValue = baseHookValue({
      group: { id: 1, name: "Grupa Nutki", organizer_party_id: 7, layout_mode: "CIRCLE", visibility: "PRIVATE" } as never,
      myAttendanceForCurrentTerm: null,
    });
    await renderPage();

    expect(
      screen.queryByRole("button", { name: "＋ Zapisz się na zajęcia" }),
    ).not.toBeInTheDocument();
  });

  it("submits the RSVP and refetches on success", async () => {
    const refetch = vi.fn();
    vi.mocked(groupsApi.createRsvp).mockResolvedValue({
      id: 1,
      term_id: 1,
      user_profile_id: 42,
      guardian_name: "Ty",
      child_count: 0,
      attached_to_account: true,
    });
    hookValue = baseHookValue({
      group: { id: 1, name: "Grupa Nutki", organizer_party_id: 7, layout_mode: "CIRCLE", visibility: "PUBLIC" } as never,
      myAttendanceForCurrentTerm: null,
      refetch,
    });
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "＋ Zapisz się na zajęcia" }));
    fireEvent.click(await screen.findByRole("button", { name: "Pomiń" }));
    fireEvent.click(screen.getByRole("button", { name: "Zapisz się" }));

    await waitFor(() =>
      expect(groupsApi.createRsvp).toHaveBeenCalledWith(1, {
        term_id: 1,
        guardian_name: "Ty",
        child_count: 0,
      }),
    );
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });
});
