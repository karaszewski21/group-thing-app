import { render, screen, waitFor, within } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";

// TODO(Group 8): this unit suite can only exercise the hamburger-promotion
// click-through and item-dialog rework at the component level — if the
// project wires up Playwright, add an end-to-end pass over the full GUEST
// "Chcę dodać krąg" → submit → organizer-view flow there.

import * as peopleApi from "../api/people";
import * as familiesApi from "../api/families";
import * as groupsApi from "../api/groups";
import * as inventoriesApi from "../api/inventories";
import * as itemListingPreferencesApi from "../api/itemListingPreferences";
import * as productsApi from "../api/products";
import * as termsApi from "../api/terms";
import * as organizationsApi from "../api/organizations";
import * as pledgesApi from "../api/pledges";
import * as notificationsApi from "../api/notifications";
import * as categoriesApi from "../api/categories";
import * as termItemListingsApi from "../api/termItemListings";
import * as reservationsApi from "../api/reservations";
import { PanelPage } from "../pages/panel/PanelPage";
import { TermPage } from "../pages/krag/TermPage";
import type { UseKragGrupyResult } from "../hooks/useKragGrupy";
import type { BrowseTermItemListingResponse } from "../api/termItemListings";
import { ApiError } from "../api/client";

vi.mock("../auth/AuthContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth/AuthContext")>();
  return {
    ...actual,
    useAuth: vi.fn(() => ({
      token: "test-token",
      username: "guest",
      displayName: "Jan Kowalski",
      permissions: [],
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    })),
  };
});

vi.mock("../api/people", () => ({
  getMyProfile: vi.fn(),
  getProfile: vi.fn(),
  getProfileByParty: vi.fn(),
  getLeadershipsForPerson: vi.fn(),
}));

vi.mock("../api/families", () => ({
  getMyFamilies: vi.fn(),
  getMembershipsForFamily: vi.fn(),
  getGuardians: vi.fn(),
  createLightweightMembers: vi.fn(),
  createOwnFamily: vi.fn(),
  renameFamily: vi.fn(),
  removeFamilyMember: vi.fn(),
}));

vi.mock("../api/groups", () => ({
  createMyCircle: vi.fn(),
  endLeadership: vi.fn(),
  getGroup: vi.fn(),
  getMyAttendances: vi.fn(),
  updateGroupLayoutMode: vi.fn(),
  // `EditTermDialog`'s "Formalizuj stałych członków" section calls these on
  // mount whenever the term's group is still PUBLIC — default resolution set
  // per-test in `mockOrganizerDefaults()` (a bare mock here would go stale
  // after each `beforeEach`'s `vi.resetAllMocks()`, same reasoning as every
  // other default below).
  getTermAttendeesForFormalization: vi.fn(),
  formalizeGroupFromTerm: vi.fn(),
  // `TermAccessBoundary` (TermPage.tsx) resolves access before rendering
  // the private/member view `renderKrag()` mounts — default set per-`describe`
  // block that calls `renderKrag()` (same `resetAllMocks()`-goes-stale
  // reasoning as `getTermAttendeesForFormalization` above).
  getGroupAccess: vi.fn(),
}));

vi.mock("../api/inventories", () => ({
  createInventory: vi.fn(),
  getInventories: vi.fn(),
  getInventoryItems: vi.fn(),
  registerInventoryItem: vi.fn(),
  updateInventoryItem: vi.fn(),
  deleteInventoryItem: vi.fn(),
  // Added alongside Group 7's own additions below: RzeczyView.tsx (Group 8)
  // already calls this on every "Moje rzeczy" render — without it, every
  // "inventory item edit/delete" test below fails on an unrelated "no
  // export defined on the mock" error the moment that view mounts.
  getInventoryItemBalances: vi.fn().mockResolvedValue({}),
  // RzeczyView.tsx reads this constant directly (not through a function
  // call) to decide whether a tile's mode toggles are locked — the mock
  // factory below replaces the whole module, so the constant must be
  // re-exported here too, not just the mocked functions.
  ACTIVE_LOCK_BALANCE_STATUSES: ["RESERVED", "IN_TRANSIT"],
}));

vi.mock("../api/itemListingPreferences", () => ({
  getMyItemListingPreferences: vi.fn(),
  setItemListingPreference: vi.fn(),
}));

vi.mock("../api/products", () => ({
  createProduct: vi.fn(),
  getProducts: vi.fn(),
  resolveProduct: vi.fn(),
}));

vi.mock("../api/terms", () => ({
  getTerms: vi.fn(),
  getTerm: vi.fn(),
  getNeededItems: vi.fn(),
  createTerm: vi.fn(),
  createNeededItem: vi.fn(),
  updateTerm: vi.fn(),
  updateNeededItem: vi.fn(),
  deleteNeededItem: vi.fn(),
}));

vi.mock("../api/organizations", () => ({
  getMyOrganization: vi.fn(),
}));

vi.mock("../api/pledges", () => ({
  getMyPledges: vi.fn(),
  withdrawPledge: vi.fn(),
}));

vi.mock("../api/notifications", () => ({
  getMyNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));

vi.mock("../api/categories", () => ({
  getCategories: vi.fn(),
}));

// Group 7: the global pending-actions modal (PanelDataContext) resolves the
// confirm-race Reservation id purely from these two term-item-listing
// endpoints (see resolvePendingReservationId's docstring) — mocked so the
// resolution/confirm-transaction flow is fully controllable per test, with
// no real network call.
vi.mock("../api/termItemListings", () => ({
  getMyTermItemListings: vi.fn(),
  getBrowseTermItemListings: vi.fn(),
  getMyTakenTermItemListings: vi.fn(),
  takeTermItemListing: vi.fn(),
  proposeSwap: vi.fn(),
  acceptSwapProposal: vi.fn(),
  rejectSwapProposal: vi.fn(),
}));

vi.mock("../api/reservations", () => ({
  getReservation: vi.fn(),
  confirmReservation: vi.fn(),
  createReservation: vi.fn(),
  fulfillReservation: vi.fn(),
  confirmTransaction: vi.fn(),
  // Bug #4c: RzeczyView's "Anuluj wymianę" tile fallback button.
  cancelTransaction: vi.fn(),
}));

// TermPage's swap-offer-dialog tests mock the whole hook (same
// pattern as test/TermPage.test.tsx) rather than every API it calls —
// the dialog/preview/proposeSwap wiring under test lives entirely in
// TermPage.tsx itself, not in the hook.
let kragHookValue: UseKragGrupyResult;

vi.mock("../hooks/useKragGrupy", () => ({
  useKragGrupy: () => kragHookValue,
}));

function browseListing(
  overrides: Partial<BrowseTermItemListingResponse> = {},
): BrowseTermItemListingResponse {
  return {
    id: 501,
    term_id: 3,
    item_id: 9,
    lister_party_id: 7,
    offered_types: ["SWAP"],
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

function baseKragHookValue(overrides: Partial<UseKragGrupyResult> = {}): UseKragGrupyResult {
  return {
    loading: false,
    error: null,
    group: { id: 5, name: "Grupa Nutki", organizer_party_id: 7 } as never,
    organizer: { party_id: 7, display_name: "Ola" } as never,
    families: [],
    myPartyId: 42,
    currentTerm: { id: 3, circle_group_id: 5, occurs_on: "2026-03-10", description: null } as never,
    neededItems: [],
    myAvailableItems: [],
    mySwapAvailableItems: [],
    myAttendanceForCurrentTerm: {
      attendance_id: 1,
      term_id: 3,
      occurs_on: "2026-03-10",
      child_count: 1,
      group_id: 5,
      group_name: "Grupa Nutki",
      organizer_display_name: "Ola",
      organizer_slug: "ola",
    },
    myItemListings: [],
    browseListings: [],
    pledgeFamilyName: () => "Rodzina Testowa",
    pledge: vi.fn(),
    withdraw: vi.fn(),
    fulfillPledgeItem: vi.fn(),
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
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderKrag() {
  return render(
    <MemoryRouter initialEntries={["/krag/5"]}>
      <Routes>
        <Route path="/krag/:groupId" element={<TermPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const mockProfile: peopleApi.UserProfileResponse = {
  id: 1,
  party_id: 1,
  account_user_id: 1,
  display_name: "Jan Kowalski",
  email: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  is_organizer: false,
};

const mockOrganizerProfile: peopleApi.UserProfileResponse = {
  ...mockProfile,
  is_organizer: true,
};

const mockInventory: inventoriesApi.InventoryResponse = {
  id: 1,
  owner_user_id: 1,
  inventory_type: "PERSONAL",
  location: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

// Seeded category ids/names (migration 0025_category_reintroduction.py).
const mockCategories: categoriesApi.Category[] = [
  { id: 1, name: "Zabawka", description: null, sortOrder: 1, productCount: 0, createdAt: "", updatedAt: "" },
  { id: 2, name: "Książka", description: null, sortOrder: 2, productCount: 0, createdAt: "", updatedAt: "" },
  { id: 3, name: "Gra", description: null, sortOrder: 3, productCount: 0, createdAt: "", updatedAt: "" },
  { id: 4, name: "Ubranie", description: null, sortOrder: 4, productCount: 0, createdAt: "", updatedAt: "" },
  { id: 5, name: "Inne", description: null, sortOrder: 5, productCount: 0, createdAt: "", updatedAt: "" },
];

const mockGroup: groupsApi.GroupResponse = {
  id: 5,
  party_id: 2,
  name: "Nowa grupa",
  organizer_slug: "ania-kowalska",
  layout_mode: "CIRCLE",
  visibility: "PUBLIC",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

// Organizer/circle whose organizer owns no Organization — the backend still
// returns a stable `k-<hash>` pseudo-slug so per-term links always work.
const mockGroupHashSlug: groupsApi.GroupResponse = {
  ...mockGroup,
  organizer_slug: "k-abc123def456",
};

// per-file clipboard stub (jsdom has no navigator.clipboard) — call history is
// wiped by vi.resetAllMocks() in each beforeEach.
const clipboardWriteText = vi.fn();
Object.assign(navigator, { clipboard: { writeText: clipboardWriteText } });

const mockFamily: familiesApi.FamilyOut = {
  id: 10,
  party_id: 99,
  name: "Kowalscy",
  child_count: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const mockAttendances: groupsApi.MyAttendanceResponse[] = [
  {
    attendance_id: 1,
    term_id: 3,
    occurs_on: "2026-02-15",
    child_count: 2,
    group_id: 5,
    group_name: "Nutki dla starszaków",
    organizer_display_name: "Ania Kowalska",
    organizer_slug: "ania-kowalska",
  },
  {
    attendance_id: 2,
    term_id: 8,
    occurs_on: "2026-03-01",
    child_count: 1,
    group_id: 6,
    group_name: "Rytmika",
    organizer_display_name: "Basia Nowak",
    organizer_slug: "basia-nowak",
  },
];

const mockGuardians: familiesApi.GuardianResponse[] = [
  {
    family_membership_id: 1,
    party_id: 1, // matches mockProfile.party_id — "(Ty)"
    user_profile_id: 1,
    display_name: "Jan Kowalski",
    email: null,
    is_primary_contact: true,
    valid_from: "2026-01-01",
    valid_to: null,
  },
  {
    family_membership_id: 2,
    party_id: 2,
    user_profile_id: 2,
    display_name: "Marek Kowalski",
    email: null,
    is_primary_contact: false,
    valid_from: "2026-01-01",
    valid_to: null,
  },
];

function renderPanel() {
  return render(
    <MemoryRouter initialEntries={["/panel"]}>
      <Routes>
        <Route path="/panel" element={<PanelPage />} />
        <Route path="/panel/:view" element={<PanelPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

// Bug #3 (cache refresh): a bare navigation harness rendered alongside the
// /panel routes so a test can drive real react-router navigation (away from
// and back to /panel) without unmounting the MemoryRouter itself — exercises
// PanelDataContext's route-watching silent-reload effect (useLocation).
function NavigationHarness() {
  const navigate = useNavigate();
  return (
    <div>
      <button type="button" onClick={() => navigate("/other")}>
        Wyjdź z panelu
      </button>
      <button type="button" onClick={() => navigate("/panel")}>
        Wróć do panelu
      </button>
    </div>
  );
}

function renderPanelWithNavigation() {
  return render(
    <MemoryRouter initialEntries={["/panel"]}>
      <NavigationHarness />
      <Routes>
        <Route path="/panel" element={<PanelPage />} />
        <Route path="/panel/:view" element={<PanelPage />} />
        <Route path="/other" element={<div>Poza panelem</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function mockGuestDefaults() {
  vi.mocked(categoriesApi.getCategories).mockResolvedValue(mockCategories);
  vi.mocked(peopleApi.getMyProfile).mockResolvedValue(mockProfile);
  vi.mocked(peopleApi.getLeadershipsForPerson).mockResolvedValue([]);
  vi.mocked(inventoriesApi.getInventories).mockResolvedValue([mockInventory]);
  vi.mocked(inventoriesApi.getInventoryItems).mockResolvedValue([]);
  vi.mocked(inventoriesApi.getInventoryItemBalances).mockResolvedValue({});
  vi.mocked(itemListingPreferencesApi.getMyItemListingPreferences).mockResolvedValue([]);
  vi.mocked(productsApi.getProducts).mockResolvedValue([]);
  vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([]);
  vi.mocked(familiesApi.getMembershipsForFamily).mockResolvedValue([]);
  vi.mocked(familiesApi.getGuardians).mockResolvedValue([]);
  vi.mocked(groupsApi.getMyAttendances).mockResolvedValue([]);
  vi.mocked(organizationsApi.getMyOrganization).mockRejectedValue(new Error("404"));
  vi.mocked(pledgesApi.getMyPledges).mockResolvedValue([]);
  vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([]);
}

function mockOrganizerDefaults() {
  vi.mocked(categoriesApi.getCategories).mockResolvedValue(mockCategories);
  vi.mocked(peopleApi.getMyProfile).mockResolvedValue(mockOrganizerProfile);
  vi.mocked(peopleApi.getLeadershipsForPerson).mockResolvedValue([
    { id: 1, from_role_id: 1, to_group_id: 5, organizer_party_id: 1, valid_from: "2026-01-01", valid_to: null },
  ]);
  vi.mocked(inventoriesApi.getInventories).mockResolvedValue([mockInventory]);
  vi.mocked(inventoriesApi.getInventoryItems).mockResolvedValue([]);
  vi.mocked(inventoriesApi.getInventoryItemBalances).mockResolvedValue({});
  vi.mocked(itemListingPreferencesApi.getMyItemListingPreferences).mockResolvedValue([]);
  vi.mocked(productsApi.getProducts).mockResolvedValue([]);
  vi.mocked(groupsApi.getGroup).mockResolvedValue(mockGroup);
  vi.mocked(groupsApi.getTermAttendeesForFormalization).mockResolvedValue([]);
  vi.mocked(termsApi.getTerms).mockResolvedValue([]);
  vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
  vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([]);
  vi.mocked(familiesApi.getGuardians).mockResolvedValue([]);
  vi.mocked(groupsApi.getMyAttendances).mockResolvedValue([]);
  vi.mocked(organizationsApi.getMyOrganization).mockRejectedValue(new Error("404"));
  vi.mocked(pledgesApi.getMyPledges).mockResolvedValue([]);
  vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([]);
}

async function openMenu() {
  const menuButton = await screen.findByRole("button", { name: "Menu" });
  fireEvent.click(menuButton);
}

describe("PanelPage — hamburger promotion", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('shows "Dodaj pierwszy termin" (not "Chcę dodać krąg") for a GUEST-without-circle session and opens FirstTermStepperGuest', async () => {
    mockGuestDefaults();
    renderPanel();
    await openMenu();

    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /Dodaj pierwszy termin/ })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: /Chcę dodać krąg/ })).not.toBeInTheDocument();

    fireEvent.click(within(menu).getByRole("menuitem", { name: /Dodaj pierwszy termin/ }));

    const dialog = await screen.findByRole("dialog", { name: "Dodaj pierwszy termin" });
    // GUEST variant: 2-step, starts on "Nazwa kręgu"
    expect(within(dialog).getByPlaceholderText("np. Nutki dla starszaków")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Dalej →" })).toBeInTheDocument();
  });

  it('the ORGANIZER-with-zero-terms home hint opens the 1-step FirstTermStepperOrganizer', async () => {
    mockOrganizerDefaults();
    renderPanel();

    // The hamburger item is gone (commented out); the home HintCard is the path.
    fireEvent.click(await screen.findByRole("button", { name: "Dodaj termin →" }));

    const dialog = await screen.findByRole("dialog", { name: "Dodaj pierwszy termin" });
    // ORGANIZER variant: 1-step, term fields only, no circle-name field
    expect(within(dialog).queryByPlaceholderText("np. Nutki dla starszaków")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Dodaj termin" })).toBeInTheDocument();
  });

  it('shows neither hamburger item for an ORGANIZER who already has terms', async () => {
    mockOrganizerDefaults();
    vi.mocked(termsApi.getTerms).mockResolvedValue([
      { id: 1, circle_group_id: 5, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "" },
    ]);
    renderPanel();
    await openMenu();

    const menu = screen.getByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: /Dodaj pierwszy termin/ })).not.toBeInTheDocument();
  });

  it('shows "Moja organizacja" (linking to /organization) for an organizer session with no Organization yet', async () => {
    mockOrganizerDefaults();
    renderPanel();
    await openMenu();

    const menu = screen.getByRole("menu");
    const link = within(menu).getByRole("menuitem", { name: /Moja organizacja/ });
    expect(link).toHaveAttribute("href", "/organization");
  });

  it('"Moja organizacja" links directly to the public organization page once one already exists', async () => {
    mockOrganizerDefaults();
    vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue({
      id: 1,
      party_id: 1,
      name: "Muzyczne Skrzaty",
      slug: "muzyczne-skrzaty",
      primary_color: null,
      accent_color: null,
      created_at: "",
      updated_at: "",
    });
    renderPanel();
    await openMenu();

    const menu = screen.getByRole("menu");
    const link = within(menu).getByRole("menuitem", { name: /Moja organizacja/ });
    expect(link).toHaveAttribute("href", "/muzyczne-skrzaty");
  });

  it("completing the GUEST 2-step flow calls createMyCircle then createTerm and flips isOrganizer to true after reload", async () => {
    mockGuestDefaults();
    // A brand-new guest circle has no Organization → the backend returns a
    // stable `k-<hash>` pseudo-slug so the done-screen CTA still deep-links
    // to the just-created term.
    vi.mocked(groupsApi.createMyCircle).mockResolvedValue(mockGroupHashSlug);
    vi.mocked(termsApi.createTerm).mockResolvedValue({
      id: 1, circle_group_id: 5, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "",
    });
    renderPanel();
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Dodaj pierwszy termin/ }));

    const dialog = await screen.findByRole("dialog", { name: "Dodaj pierwszy termin" });
    fireEvent.change(within(dialog).getByPlaceholderText("np. Nutki dla starszaków"), {
      target: { value: "Nutki" },
    });

    // Step 1 -> step 2 immediately triggers a `load()` refresh (via
    // onCircleCreated) so a reopened menu already reflects the new circle.
    vi.mocked(peopleApi.getLeadershipsForPerson).mockResolvedValue([
      { id: 1, from_role_id: 1, to_group_id: 5, organizer_party_id: 1, valid_from: "2026-01-01", valid_to: null },
    ]);
    vi.mocked(groupsApi.getGroup).mockResolvedValue(mockGroup);
    vi.mocked(groupsApi.getTermAttendeesForFormalization).mockResolvedValue([]);
    vi.mocked(termsApi.getTerms).mockResolvedValue([]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Dalej →" }));
    await waitFor(() => expect(groupsApi.createMyCircle).toHaveBeenCalledWith({ name: "Nutki" }));

    const dateInput = await within(dialog).findByLabelText("Data i godzina");
    fireEvent.change(dateInput, { target: { value: "2026-02-01T17:00" } });

    // After the term is created, the final (non-silent) `load()` re-fetches
    // terms — reflect that a term now exists so the hamburger item's
    // `terms.length === 0` gate correctly hides it below.
    vi.mocked(termsApi.getTerms).mockResolvedValue([
      { id: 1, circle_group_id: 5, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "" },
    ]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj" }));

    await waitFor(() =>
      expect(termsApi.createTerm).toHaveBeenCalledWith({
        circle_group_id: mockGroup.id,
        occurs_on: "2026-02-01T17:00",
        description: undefined,
      }),
    );

    // Dialog stays open, offering a switch to the public circle page,
    // instead of closing immediately — deep-linked to the created term via
    // the circle's (hash) slug.
    const publicLink = await within(dialog).findByRole("link", {
      name: /Przejdź do publicznej strony/,
    });
    expect(publicLink).toHaveAttribute(
      "href",
      `/${mockGroupHashSlug.organizer_slug}/grupa/${mockGroupHashSlug.id}/term/1`,
    );

    fireEvent.click(within(dialog).getByRole("button", { name: "Gotowe" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await openMenu();
    const menu = screen.getByRole("menu");
    await waitFor(() =>
      expect(within(menu).queryByRole("menuitem", { name: /Dodaj pierwszy termin/ })).not.toBeInTheDocument(),
    );
  });

  it("shows an inline error (not a silent failure) when createMyCircle rejects in the GUEST stepper", async () => {
    // Regression test for a code-review finding: FirstTermStepperGuest's
    // handleStep1 had no catch block, so a failed createMyCircle call
    // became an unhandled promise rejection with no user-facing feedback.
    mockGuestDefaults();
    vi.mocked(groupsApi.createMyCircle).mockRejectedValue(new Error("network error"));
    renderPanel();
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Dodaj pierwszy termin/ }));

    const dialog = await screen.findByRole("dialog", { name: "Dodaj pierwszy termin" });
    fireEvent.change(within(dialog).getByPlaceholderText("np. Nutki dla starszaków"), {
      target: { value: "Nutki" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dalej →" }));

    expect(
      await within(dialog).findByText("Nie udało się utworzyć kręgu — spróbuj ponownie"),
    ).toBeInTheDocument();
    // Dialog stays open on failure — no silent close/no-op.
    expect(screen.getByRole("dialog", { name: "Dodaj pierwszy termin" })).toBeInTheDocument();
  });
});

describe("PanelPage — item add dialog rework", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('the "+ Dodaj rzecz" modal renders ItemQuickAddForm (3 fields, no product dropdown)', async () => {
    mockGuestDefaults();
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Moje rzeczy" }));
    fireEvent.click(await screen.findByRole("button", { name: "+ Dodaj rzecz" }));

    const dialog = await screen.findByRole("dialog", { name: "Dodaj rzecz" });
    expect(within(dialog).getByLabelText("Nazwa")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Stan")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Typ")).toBeInTheDocument();
    expect(within(dialog).queryByText("+ inny przedmiot")).not.toBeInTheDocument();
  });

  it("submitting it calls resolveProduct then registerInventoryItem with the resolved product_id", async () => {
    mockGuestDefaults();
    vi.mocked(productsApi.resolveProduct).mockResolvedValue({
      id: 42,
      name: "Rowerek",
      description: null,
      photoUrl: null,
      sku: "SKU",
      category_id: 1,
      pluginData: null,
      createdAt: "",
      updatedAt: "",
    });
    vi.mocked(inventoriesApi.registerInventoryItem).mockResolvedValue({
      id: 1,
      inventory_id: 1,
      home_inventory_id: null,
      product_id: 42,
      product_name: "Rowerek",
      condition: "GOOD",
      added_at: "",
      created_at: "",
      updated_at: "",
    });

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Moje rzeczy" }));
    fireEvent.click(await screen.findByRole("button", { name: "+ Dodaj rzecz" }));

    const dialog = await screen.findByRole("dialog", { name: "Dodaj rzecz" });
    fireEvent.change(within(dialog).getByLabelText("Nazwa"), { target: { value: "Rowerek" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj rzecz" }));

    await waitFor(() =>
      expect(productsApi.resolveProduct).toHaveBeenCalledWith({ name: "Rowerek", category_id: 1 }),
    );
    await waitFor(() =>
      expect(inventoriesApi.registerInventoryItem).toHaveBeenCalledWith({
        inventory_id: 1,
        product_id: 42,
        condition: "GOOD",
      }),
    );
  });
});

describe("PanelPage — dismissible home hints", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
  });

  it("GUEST hint renders on Panel home and dismiss persists across a re-mount via localStorage", async () => {
    mockGuestDefaults();
    const { unmount } = renderPanel();

    expect(await screen.findByText("Dodaj swój pierwszy termin")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Zamknij: Dodaj swój pierwszy termin" }));
    expect(screen.queryByText("Dodaj swój pierwszy termin")).not.toBeInTheDocument();
    expect(localStorage.getItem("hint_first_term_dismissed")).toBe("1");

    unmount();
    mockGuestDefaults();
    renderPanel();
    await screen.findByRole("heading", { name: /Cześć/ });
    expect(screen.queryByText("Dodaj swój pierwszy termin")).not.toBeInTheDocument();
  });

  it('GUEST sees a "Możesz zostać organizatorem" card that opens the circle-creation flow and dismisses on its own key', async () => {
    mockGuestDefaults();
    renderPanel();

    expect(await screen.findByText("Możesz zostać organizatorem")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Załóż krąg →" }));
    const dialog = await screen.findByRole("dialog", { name: "Dodaj pierwszy termin" });
    // guest 2-step flow — step 1 is the circle-name field (the "add a group" shortcut)
    expect(within(dialog).getByPlaceholderText("np. Nutki dla starszaków")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Zamknij" }));

    fireEvent.click(screen.getByRole("button", { name: "Zamknij: Możesz zostać organizatorem" }));
    expect(screen.queryByText("Możesz zostać organizatorem")).not.toBeInTheDocument();
    expect(localStorage.getItem("hint_become_organizer_dismissed")).toBe("1");
    // the other guest card is independent
    expect(screen.getByText("Dodaj swój pierwszy termin")).toBeInTheDocument();
  });

  it("a GUEST who dismissed the pre-promotion first-term card still sees the organizer first-term card after getting a circle", async () => {
    localStorage.setItem("hint_first_term_dismissed", "1");
    mockOrganizerDefaults(); // organizer-by-circle, zero terms
    renderPanel();

    expect(await screen.findByText("Ustal pierwsze zajęcia w swoim kręgu.")).toBeInTheDocument();
  });

  it("both ORGANIZER hints render stacked (org-polish first, first-term second) and dismiss independently via their own localStorage keys", async () => {
    mockOrganizerDefaults();
    renderPanel();

    await screen.findByText("Dopracuj stronę organizacji");
    const html = document.body.innerHTML;
    expect(html.indexOf("Dopracuj stronę organizacji")).toBeLessThan(
      html.indexOf("Dodaj swój pierwszy termin"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Zamknij: Dopracuj stronę organizacji" }));
    expect(screen.queryByText("Dopracuj stronę organizacji")).not.toBeInTheDocument();
    expect(screen.getByText("Dodaj swój pierwszy termin")).toBeInTheDocument();
    expect(localStorage.getItem("hint_org_polish_dismissed")).toBe("1");
    expect(localStorage.getItem("hint_org_first_term_dismissed")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Zamknij: Dodaj swój pierwszy termin" }));
    expect(screen.queryByText("Dodaj swój pierwszy termin")).not.toBeInTheDocument();
    expect(localStorage.getItem("hint_org_first_term_dismissed")).toBe("1");
  });

  it("ORGANIZER first-term hint auto-hides once terms.length > 0, with no manual dismiss needed", async () => {
    mockOrganizerDefaults();
    vi.mocked(termsApi.getTerms).mockResolvedValue([
      { id: 1, circle_group_id: 5, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "" },
    ]);
    renderPanel();

    await screen.findByText("Dopracuj stronę organizacji");
    expect(screen.queryByText("Ustal pierwsze zajęcia w swoim kręgu.")).not.toBeInTheDocument();
  });

  it('org-polish hint\'s CTA links to "/organization" when no Organization exists yet', async () => {
    mockOrganizerDefaults();
    renderPanel();

    const link = await screen.findByRole("link", { name: "Przejdź →" });
    expect(link).toHaveAttribute("href", "/organization");
  });

  it("org-polish hint's CTA links directly to the public organization page once one already exists", async () => {
    mockOrganizerDefaults();
    vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue({
      id: 1,
      party_id: 1,
      name: "Muzyczne Skrzaty",
      slug: "muzyczne-skrzaty",
      primary_color: null,
      accent_color: null,
      created_at: "",
      updated_at: "",
    });
    renderPanel();

    const link = await screen.findByRole("link", { name: "Przejdź →" });
    expect(link).toHaveAttribute("href", "/muzyczne-skrzaty");
  });

  // --- Group 11 gap review: cross-group composition (Group 6 stepper + Group 7 hint) ---

  it("GUEST hint auto-disappears after completing the real 2-step first-term stepper (isOrganizer flip, not a manual dismiss)", async () => {
    mockGuestDefaults();
    vi.mocked(groupsApi.createMyCircle).mockResolvedValue(mockGroup);
    vi.mocked(termsApi.createTerm).mockResolvedValue({
      id: 1, circle_group_id: 5, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "",
    });
    renderPanel();

    expect(await screen.findByText("Dodaj swój pierwszy termin")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zacznijmy →" }));

    const dialog = await screen.findByRole("dialog", { name: "Dodaj pierwszy termin" });
    fireEvent.change(within(dialog).getByPlaceholderText("np. Nutki dla starszaków"), {
      target: { value: "Nutki" },
    });

    vi.mocked(peopleApi.getLeadershipsForPerson).mockResolvedValue([
      { id: 1, from_role_id: 1, to_group_id: 5, organizer_party_id: 1, valid_from: "2026-01-01", valid_to: null },
    ]);
    vi.mocked(groupsApi.getGroup).mockResolvedValue(mockGroup);
    vi.mocked(groupsApi.getTermAttendeesForFormalization).mockResolvedValue([]);
    vi.mocked(termsApi.getTerms).mockResolvedValue([]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Dalej →" }));
    await waitFor(() => expect(groupsApi.createMyCircle).toHaveBeenCalled());

    const dateInput = await within(dialog).findByLabelText("Data i godzina");
    fireEvent.change(dateInput, { target: { value: "2026-02-01T17:00" } });

    vi.mocked(termsApi.getTerms).mockResolvedValue([
      { id: 1, circle_group_id: 5, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "" },
    ]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj" }));

    await waitFor(() => expect(termsApi.createTerm).toHaveBeenCalled());
    fireEvent.click(await within(dialog).findByRole("button", { name: "Gotowe" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // Hint disappears purely because `!isOrganizer` flips false — it was
    // never dismissed via its own "Zamknij" button in this test.
    await waitFor(() => expect(screen.queryByText("Dodaj swój pierwszy termin")).not.toBeInTheDocument());
    expect(localStorage.getItem("hint_first_term_dismissed")).toBeNull();
  });

  it("ORGANIZER first-term hint auto-hides after a term is added via the real ORGANIZER 1-step stepper (not just terms mocked directly)", async () => {
    mockOrganizerDefaults();
    vi.mocked(termsApi.createTerm).mockResolvedValue({
      id: 1, circle_group_id: 5, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "",
    });
    renderPanel();

    expect(await screen.findByText("Ustal pierwsze zajęcia w swoim kręgu.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dodaj termin →" }));

    const dialog = await screen.findByRole("dialog", { name: "Dodaj pierwszy termin" });
    const dateInput = await within(dialog).findByLabelText("Data i godzina");
    fireEvent.change(dateInput, { target: { value: "2026-02-01T17:00" } });

    vi.mocked(termsApi.getTerms).mockResolvedValue([
      { id: 1, circle_group_id: 5, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "" },
    ]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj termin" }));

    await waitFor(() => expect(termsApi.createTerm).toHaveBeenCalled());
    fireEvent.click(await within(dialog).findByRole("button", { name: "Gotowe" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await waitFor(() =>
      expect(screen.queryByText("Ustal pierwsze zajęcia w swoim kręgu.")).not.toBeInTheDocument(),
    );
    // org-polish hint is a separate, still-undismissed card — unaffected.
    expect(screen.getByText("Dopracuj stronę organizacji")).toBeInTheDocument();
  });
});

describe("PanelPage — Rodzina section", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('"Mój dom" hamburger item renders and navigates to the family list (name + role tag, no avatars)', async () => {
    mockGuestDefaults();
    vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([mockFamily]);
    vi.mocked(familiesApi.getGuardians).mockResolvedValue(mockGuardians);
    renderPanel();
    await openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: /Mój dom/ }));

    expect(await screen.findByRole("heading", { name: "Mój dom", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("Jan Kowalski", { selector: "h3" })).toBeInTheDocument();
    expect(screen.getByText("(Ty)")).toBeInTheDocument();
    expect(screen.getByText("Marek Kowalski", { selector: "h3" })).toBeInTheDocument();
    expect(screen.getByText("(opiekun)")).toBeInTheDocument();
    // no avatars — rows carry no <img> element
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });

  it("inline add-member form submits and the new member appears without a reload", async () => {
    mockGuestDefaults();
    vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([mockFamily]);
    vi.mocked(familiesApi.getGuardians).mockResolvedValueOnce([]).mockResolvedValueOnce(mockGuardians);
    vi.mocked(familiesApi.createLightweightMembers).mockResolvedValue({
      family: mockFamily,
      guardians: mockGuardians,
    });
    renderPanel();
    await openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: /Mój dom/ }));
    await screen.findByRole("heading", { name: "Mój dom", level: 2 });

    fireEvent.change(screen.getByPlaceholderText("np. Zosia Kowalska"), {
      target: { value: "Marek Kowalski" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj" }));

    await waitFor(() =>
      expect(familiesApi.createLightweightMembers).toHaveBeenCalledWith([
        { name: "Marek Kowalski", role_type: "GUARDIAN" },
      ]),
    );
    // list refreshes in place — no reload/navigation required
    expect(await screen.findByText("Marek Kowalski")).toBeInTheDocument();
  });

  it('the "Mój dom" section is reachable and shows the same family list for both GUEST and ORGANIZER accounts', async () => {
    mockOrganizerDefaults();
    vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([mockFamily]);
    vi.mocked(familiesApi.getGuardians).mockResolvedValue(mockGuardians);
    renderPanel();
    await openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: /Mój dom/ }));

    expect(await screen.findByRole("heading", { name: "Mój dom", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("Jan Kowalski", { selector: "h3" })).toBeInTheDocument();
    expect(screen.getByText("Marek Kowalski", { selector: "h3" })).toBeInTheDocument();
  });
});

describe("PanelPage — Mój dom — no family", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  async function openMojDom() {
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Mój dom/ }));
  }

  it("renders the no-family empty-state card with a CTA for a GUEST", async () => {
    mockGuestDefaults();
    renderPanel();
    await openMojDom();

    expect(await screen.findByText("Nie masz jeszcze rodziny")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Załóż rodzinę" })).toBeInTheDocument();
  });

  it("renders the no-family empty-state card with a CTA for an ORGANIZER", async () => {
    mockOrganizerDefaults();
    renderPanel();
    await openMojDom();

    expect(await screen.findByText("Nie masz jeszcze rodziny")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Załóż rodzinę" })).toBeInTheDocument();
  });

  it("the CTA opens CreateFamilyDialog", async () => {
    mockGuestDefaults();
    renderPanel();
    await openMojDom();

    fireEvent.click(await screen.findByRole("button", { name: "Załóż rodzinę" }));

    const dialog = await screen.findByRole("dialog", { name: "Załóż rodzinę" });
    expect(within(dialog).getByLabelText("Nazwa rodziny")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Dalej" })).toBeInTheDocument();
  });

  it("step 1 submits the typed name to createOwnFamily and advances to step 2", async () => {
    mockGuestDefaults();
    vi.mocked(familiesApi.createOwnFamily).mockResolvedValue({ ...mockFamily, name: "Nowakowie" });
    renderPanel();
    await openMojDom();
    fireEvent.click(await screen.findByRole("button", { name: "Załóż rodzinę" }));

    const dialog = await screen.findByRole("dialog", { name: "Załóż rodzinę" });
    fireEvent.change(within(dialog).getByLabelText("Nazwa rodziny"), { target: { value: "Nowakowie" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dalej" }));

    await waitFor(() => expect(familiesApi.createOwnFamily).toHaveBeenCalledWith("Nowakowie"));
    expect(familiesApi.createOwnFamily).toHaveBeenCalledTimes(1);
    expect(await within(dialog).findByRole("button", { name: "Zakończ" })).toBeInTheDocument();
  });

  it("step 2 with drafted members calls createLightweightMembers once with all rows, then the family shows in Mój dom", async () => {
    mockGuestDefaults();
    vi.mocked(familiesApi.createOwnFamily).mockResolvedValue(mockFamily);
    vi.mocked(familiesApi.createLightweightMembers).mockResolvedValue({
      family: mockFamily,
      guardians: mockGuardians,
    });
    renderPanel();
    await openMojDom();
    fireEvent.click(await screen.findByRole("button", { name: "Załóż rodzinę" }));

    const dialog = await screen.findByRole("dialog", { name: "Załóż rodzinę" });
    fireEvent.change(within(dialog).getByLabelText("Nazwa rodziny"), { target: { value: "Kowalscy" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dalej" }));

    await within(dialog).findByRole("button", { name: "Zakończ" });

    fireEvent.change(within(dialog).getByLabelText("Imię i nazwisko"), { target: { value: "Marek Kowalski" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Opiekun" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj kolejną osobę" }));

    fireEvent.change(within(dialog).getByLabelText("Imię i nazwisko"), { target: { value: "Zosia Kowalska" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dziecko" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj kolejną osobę" }));

    // family exists after the silent refresh that follows the dialog
    vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([mockFamily]);
    vi.mocked(familiesApi.getGuardians).mockResolvedValue(mockGuardians);

    fireEvent.click(within(dialog).getByRole("button", { name: "Zakończ" }));

    await waitFor(() =>
      expect(familiesApi.createLightweightMembers).toHaveBeenCalledWith([
        { name: "Marek Kowalski", role_type: "GUARDIAN" },
        { name: "Zosia Kowalska", role_type: "CHILD" },
      ]),
    );
    expect(familiesApi.createLightweightMembers).toHaveBeenCalledTimes(1);

    fireEvent.click(await within(dialog).findByRole("button", { name: "Gotowe" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Kowalscy", { selector: "h3" })).toBeInTheDocument();
  });

  it("reopening the dialog after closing mid-flow starts clean on step 1 (local state, no stale name/step)", async () => {
    mockGuestDefaults();
    vi.mocked(familiesApi.createOwnFamily).mockResolvedValue(mockFamily);
    renderPanel();
    await openMojDom();
    fireEvent.click(await screen.findByRole("button", { name: "Załóż rodzinę" }));

    let dialog = await screen.findByRole("dialog", { name: "Załóż rodzinę" });
    fireEvent.change(within(dialog).getByLabelText("Nazwa rodziny"), { target: { value: "Kowalscy" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dalej" }));
    await within(dialog).findByRole("button", { name: "Zakończ" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Zamknij" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(await screen.findByRole("button", { name: "Załóż rodzinę" }));
    dialog = await screen.findByRole("dialog", { name: "Załóż rodzinę" });
    expect(within(dialog).getByLabelText("Nazwa rodziny")).toHaveValue("");
    expect(within(dialog).getByRole("button", { name: "Dalej" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Zakończ" })).not.toBeInTheDocument();
  });

  it("step 2 skipped makes no members call and the family is still visible", async () => {
    mockGuestDefaults();
    vi.mocked(familiesApi.createOwnFamily).mockResolvedValue(mockFamily);
    renderPanel();
    await openMojDom();
    fireEvent.click(await screen.findByRole("button", { name: "Załóż rodzinę" }));

    const dialog = await screen.findByRole("dialog", { name: "Załóż rodzinę" });
    fireEvent.change(within(dialog).getByLabelText("Nazwa rodziny"), { target: { value: "Kowalscy" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dalej" }));

    vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([mockFamily]);
    vi.mocked(familiesApi.getGuardians).mockResolvedValue(mockGuardians);

    fireEvent.click(await within(dialog).findByRole("button", { name: "Zakończ" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "Gotowe" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(familiesApi.createLightweightMembers).not.toHaveBeenCalled();
    expect(await screen.findByText("Kowalscy", { selector: "h3" })).toBeInTheDocument();
  });

  it("removing a middle draft member keeps the other rows' names/roles intact (stable keys, no bleed)", async () => {
    mockGuestDefaults();
    vi.mocked(familiesApi.createOwnFamily).mockResolvedValue(mockFamily);
    renderPanel();
    await openMojDom();
    fireEvent.click(await screen.findByRole("button", { name: "Załóż rodzinę" }));

    const dialog = await screen.findByRole("dialog", { name: "Załóż rodzinę" });
    fireEvent.change(within(dialog).getByLabelText("Nazwa rodziny"), { target: { value: "Kowalscy" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dalej" }));
    await within(dialog).findByRole("button", { name: "Zakończ" });

    const addPerson = (name: string, role: "Opiekun" | "Dziecko") => {
      fireEvent.change(within(dialog).getByLabelText("Imię i nazwisko"), { target: { value: name } });
      fireEvent.click(within(dialog).getByRole("button", { name: role }));
      fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj kolejną osobę" }));
    };
    addPerson("Anna Nowak", "Opiekun");
    addPerson("Bartek Nowak", "Dziecko");
    addPerson("Celina Nowak", "Dziecko");

    const rows = within(dialog).getAllByRole("listitem");
    expect(rows).toHaveLength(3);

    // remove the middle row — with an array-index key this would shift the
    // third row's name/role onto the second position.
    fireEvent.click(within(rows[1]).getByRole("button", { name: "Usuń" }));

    const remaining = within(dialog).getAllByRole("listitem");
    expect(remaining).toHaveLength(2);
    expect(remaining[0]).toHaveTextContent("Anna Nowak");
    expect(remaining[0]).toHaveTextContent("Opiekun");
    expect(remaining[1]).toHaveTextContent("Celina Nowak");
    expect(remaining[1]).toHaveTextContent("Dziecko");
    expect(within(dialog).queryByText("Bartek Nowak")).not.toBeInTheDocument();

    // and the surviving rows submit with the correct role mapping
    vi.mocked(familiesApi.createLightweightMembers).mockResolvedValue({
      family: mockFamily,
      guardians: mockGuardians,
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Zakończ" }));
    await waitFor(() =>
      expect(familiesApi.createLightweightMembers).toHaveBeenCalledWith([
        { name: "Anna Nowak", role_type: "GUARDIAN" },
        { name: "Celina Nowak", role_type: "CHILD" },
      ]),
    );
  });
});

describe("PanelPage — Mój dom — inline family rename", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  async function openMojDom() {
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Mój dom/ }));
    await screen.findByRole("heading", { name: "Mój dom", level: 2 });
  }

  it("calls renameFamily and updates the heading in place", async () => {
    mockGuestDefaults();
    vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([mockFamily]);
    vi.mocked(familiesApi.getGuardians).mockResolvedValue(mockGuardians);
    vi.mocked(familiesApi.renameFamily).mockResolvedValue({ ...mockFamily, name: "Nowakowie" });
    renderPanel();
    await openMojDom();

    fireEvent.click(screen.getByRole("button", { name: "Zmień nazwę rodziny" }));
    const input = screen.getByLabelText("Nazwa rodziny");
    fireEvent.change(input, { target: { value: "Nowakowie" } });

    vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([{ ...mockFamily, name: "Nowakowie" }]);
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    await waitFor(() => expect(familiesApi.renameFamily).toHaveBeenCalledWith(10, "Nowakowie"));
    expect(await screen.findByText("Nowakowie", { selector: "h3" })).toBeInTheDocument();
  });

  it("network error shows an inline message and restores the previous name", async () => {
    mockGuestDefaults();
    vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([mockFamily]);
    vi.mocked(familiesApi.getGuardians).mockResolvedValue(mockGuardians);
    vi.mocked(familiesApi.renameFamily).mockRejectedValue(new Error("network"));
    renderPanel();
    await openMojDom();

    fireEvent.click(screen.getByRole("button", { name: "Zmień nazwę rodziny" }));
    fireEvent.change(screen.getByLabelText("Nazwa rodziny"), { target: { value: "Nowakowie" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    expect(await screen.findByText(/Nie udało się zmienić nazwy/)).toBeInTheDocument();
    expect(screen.getByText("Kowalscy", { selector: "h3" })).toBeInTheDocument();
  });
});

describe("PanelPage — Mój dom — remove family member", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  async function openMojDom() {
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Mój dom/ }));
    await screen.findByRole("heading", { name: "Mój dom", level: 2 });
  }

  it("removes a family member and refreshes the list", async () => {
    mockGuestDefaults();
    vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([mockFamily]);
    vi.mocked(familiesApi.getGuardians)
      .mockResolvedValueOnce(mockGuardians)
      .mockResolvedValueOnce([mockGuardians[0]]);
    vi.mocked(familiesApi.removeFamilyMember).mockResolvedValue(undefined);
    renderPanel();
    await openMojDom();

    expect(screen.getByText("Marek Kowalski", { selector: "h3" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Usuń członka rodziny Marek Kowalski" }));

    await waitFor(() =>
      expect(familiesApi.removeFamilyMember).toHaveBeenCalledWith(10, 2),
    );
    await waitFor(() =>
      expect(screen.queryByText("Marek Kowalski", { selector: "h3" })).not.toBeInTheDocument(),
    );
  });

  it("shows an inline error when member removal is rejected (e.g. last guardian 409)", async () => {
    mockGuestDefaults();
    vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([mockFamily]);
    vi.mocked(familiesApi.getGuardians).mockResolvedValue(mockGuardians);
    vi.mocked(familiesApi.removeFamilyMember).mockRejectedValue(
      new ApiError(409, "Conflict", { message: "Nie można usunąć jedynego opiekuna rodziny" }),
    );
    renderPanel();
    await openMojDom();

    fireEvent.click(screen.getByRole("button", { name: "Usuń członka rodziny Marek Kowalski" }));

    expect(
      await screen.findByText("Nie można usunąć jedynego opiekuna rodziny"),
    ).toBeInTheDocument();
    expect(screen.getByText("Marek Kowalski", { selector: "h3" })).toBeInTheDocument();
  });
});

describe("PanelPage — term edit dialog", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const term = {
    id: 1,
    circle_group_id: 5,
    occurs_on: "2026-02-01",
    description: "Pierwsze zajęcia",
    created_at: "",
    updated_at: "",
  };

  async function openEditDialog() {
    fireEvent.click(await screen.findByRole("button", { name: "Spotkania" }));
    await screen.findByRole("heading", { name: "Terminy" });
    fireEvent.click((await screen.findAllByRole("button", { name: "Edytuj termin" }))[0]);
    return screen.findByRole("dialog", { name: "Edytuj termin" });
  }

  it("calls updateTerm with only the changed occurs_on field", async () => {
    mockOrganizerDefaults();
    vi.mocked(termsApi.getTerms).mockResolvedValue([term]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
    vi.mocked(termsApi.updateTerm).mockResolvedValue({ ...term, occurs_on: "2026-03-09T18:00:00" });
    renderPanel();
    const dialog = await openEditDialog();

    fireEvent.change(within(dialog).getByLabelText("Data i godzina"), { target: { value: "2026-03-09T18:00" } });
    vi.mocked(termsApi.getTerms).mockResolvedValue([{ ...term, occurs_on: "2026-03-09T18:00:00" }]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Zapisz" }));

    await waitFor(() =>
      expect(termsApi.updateTerm).toHaveBeenCalledWith(1, { occurs_on: "2026-03-09T18:00" }),
    );
    // a silent reload runs after the successful save
    await waitFor(() => expect(vi.mocked(termsApi.getTerms).mock.calls.length).toBeGreaterThan(1));
  });

  it("shows an inline error and stays open when the save is rejected", async () => {
    mockOrganizerDefaults();
    vi.mocked(termsApi.getTerms).mockResolvedValue([term]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
    vi.mocked(termsApi.updateTerm).mockRejectedValue(new Error("400"));
    renderPanel();
    const dialog = await openEditDialog();

    fireEvent.change(within(dialog).getByLabelText("Opis"), { target: { value: "Zmieniony opis" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Zapisz" }));

    expect(await within(dialog).findByText(/Nie udało się zapisać zmian terminu/)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Edytuj termin" })).toBeInTheDocument();
  });

  it("closes without calling updateTerm when nothing changed", async () => {
    mockOrganizerDefaults();
    vi.mocked(termsApi.getTerms).mockResolvedValue([term]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
    renderPanel();
    const dialog = await openEditDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "Zapisz" }));

    expect(termsApi.updateTerm).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Edytuj termin" })).not.toBeInTheDocument(),
    );
  });

  // Group 4 (promote-term-attendees-to-members): the "Formalizuj stałych
  // członków" section no longer gates on family resolution or group
  // visibility — every non-member attendee is selectable and pre-selected,
  // regardless of `family_id`.
  const mockAttendees: groupsApi.TermAttendeeResponse[] = [
    {
      party_id: 200,
      display_name: "Zosia Nowak",
      child_count: 0,
      family_id: 10,
      family_name: "Nowakowie",
      already_member: false,
    },
    {
      party_id: 201,
      display_name: "Tomek Wiśniewski",
      child_count: 0,
      family_id: null,
      family_name: null,
      already_member: false,
    },
  ];

  it("submits the pre-selected attendees' party_ids and shows the shared success copy", async () => {
    mockOrganizerDefaults();
    vi.mocked(termsApi.getTerms).mockResolvedValue([term]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
    vi.mocked(groupsApi.getTermAttendeesForFormalization).mockResolvedValue(mockAttendees);
    vi.mocked(groupsApi.formalizeGroupFromTerm).mockResolvedValue(mockGroup);
    renderPanel();
    const dialog = await openEditDialog();

    // Both attendees are pre-selected (neither is already_member); deselect
    // one so the asserted party_ids call exercises real selection state
    // rather than just "everything returned by the fetch".
    fireEvent.click(
      await within(dialog).findByLabelText("Ustal Tomek Wiśniewski jako stałego członka"),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Ustal stałych członków" }));

    await waitFor(() =>
      expect(groupsApi.formalizeGroupFromTerm).toHaveBeenCalledWith(5, 1, [200]),
    );
    expect(
      await within(dialog).findByText("Dodano 1 osobę jako stałych członków grupy."),
    ).toBeInTheDocument();
  });

  it("leaves a family-less attendee's row selectable and pre-selected", async () => {
    mockOrganizerDefaults();
    vi.mocked(termsApi.getTerms).mockResolvedValue([term]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
    vi.mocked(groupsApi.getTermAttendeesForFormalization).mockResolvedValue(mockAttendees);
    renderPanel();
    const dialog = await openEditDialog();

    const checkbox = await within(dialog).findByLabelText(
      "Ustal Tomek Wiśniewski jako stałego członka",
    );
    expect(checkbox).not.toBeDisabled();
    expect(checkbox).toBeChecked();
  });

  it("shows an inline error and stays open when formalizeGroupFromTerm fails", async () => {
    // Group 7 gap analysis: the success path is covered above, but the
    // error/retry path on this surface (mirroring
    // TermPage.test.tsx's "shows the inline error message when the
    // submit fails") was never exercised at the /panel surface.
    mockOrganizerDefaults();
    vi.mocked(termsApi.getTerms).mockResolvedValue([term]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
    vi.mocked(groupsApi.getTermAttendeesForFormalization).mockResolvedValue(mockAttendees);
    vi.mocked(groupsApi.formalizeGroupFromTerm).mockRejectedValue(new Error("boom"));
    renderPanel();
    const dialog = await openEditDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "Ustal stałych członków" }));

    expect(
      await within(dialog).findByText(
        "Nie udało się ustalić stałych członków — spróbuj ponownie",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Edytuj termin" })).toBeInTheDocument();
  });
});

describe("PanelPage — edit group dialog (name/location/spots/layout, replaces old inline rename + layout pills)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  async function openEditDialog() {
    fireEvent.click(await screen.findByRole("button", { name: "Spotkania" }));
    await screen.findByRole("heading", { name: "Grupy" });
    fireEvent.click(await screen.findByRole("button", { name: "Edytuj grupę Nowa grupa" }));
    await screen.findByRole("dialog", { name: "Edytuj grupę" });
  }

  it("pre-fills the form from the group's current name and layout_mode", async () => {
    mockOrganizerDefaults();
    renderPanel();
    await openEditDialog();

    expect(screen.getByLabelText("Nazwa grupy")).toHaveValue("Nowa grupa");
    expect(screen.getByLabelText("Szablon wizualizacji")).toHaveValue("CIRCLE");
  });

  it("saves name + layout in one updateGroupLayoutMode call and closes on success", async () => {
    mockOrganizerDefaults();
    vi.mocked(groupsApi.updateGroupLayoutMode).mockResolvedValue({
      ...mockGroup,
      name: "Nutki",
      layout_mode: "PITCH",
    });
    renderPanel();
    await openEditDialog();

    fireEvent.change(screen.getByLabelText("Nazwa grupy"), { target: { value: "Nutki" } });
    fireEvent.change(screen.getByLabelText("Szablon wizualizacji"), { target: { value: "PITCH" } });
    // The post-save `load({ silent: true })` re-fetches via `getGroup` — only
    // switch its resolved value to the updated name/layout NOW, after the
    // dialog already opened against the original "Nowa grupa" fixture.
    vi.mocked(groupsApi.getGroup).mockResolvedValue({ ...mockGroup, name: "Nutki", layout_mode: "PITCH" });
    vi.mocked(groupsApi.getTermAttendeesForFormalization).mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    await waitFor(() =>
      expect(groupsApi.updateGroupLayoutMode).toHaveBeenCalledWith(5, "Nutki", "PITCH", "PUBLIC"),
    );
    expect(await screen.findByText("Nutki", { selector: "h3" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Edytuj grupę" })).not.toBeInTheDocument();
  });

  it("shows an inline error and keeps the dialog open on a rejected save", async () => {
    mockOrganizerDefaults();
    vi.mocked(groupsApi.updateGroupLayoutMode).mockRejectedValue(new Error("500"));
    renderPanel();
    await openEditDialog();

    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    expect(await screen.findByText(/Nie udało się zapisać zmian/)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Edytuj grupę" })).toBeInTheDocument();
  });
});

describe("PanelPage — Zapisane zajęcia", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("renders one tile per attendance with a public-term link (GUEST)", async () => {
    mockGuestDefaults();
    vi.mocked(groupsApi.getMyAttendances).mockResolvedValue(mockAttendances);
    renderPanel();

    await screen.findByRole("heading", { name: "Zapisane zajęcia" });
    const first = await screen.findByRole("link", { name: /Nutki dla starszaków/ });
    expect(first).toHaveAttribute("href", "/ania-kowalska/grupa/5/term/3");
    expect(first).toHaveTextContent("Ania Kowalska");
    const second = screen.getByRole("link", { name: /Rytmika/ });
    expect(second).toHaveAttribute("href", "/basia-nowak/grupa/6/term/8");
  });

  it("renders a dashed empty state and no error when there are no attendances", async () => {
    mockGuestDefaults();
    renderPanel();

    await screen.findByRole("heading", { name: "Zapisane zajęcia" });
    expect(screen.getByText("Nie zapisałeś się jeszcze na żadne zajęcia.")).toBeInTheDocument();
    expect(screen.queryByText(/Nie udało się/)).not.toBeInTheDocument();
  });

  it("renders the empty state and no error when getMyAttendances rejects (load() guard)", async () => {
    mockGuestDefaults();
    vi.mocked(groupsApi.getMyAttendances).mockRejectedValue(new Error("500"));
    renderPanel();

    await screen.findByRole("heading", { name: /Cześć/ });
    expect(await screen.findByRole("heading", { name: "Zapisane zajęcia" })).toBeInTheDocument();
    expect(screen.getByText("Nie zapisałeś się jeszcze na żadne zajęcia.")).toBeInTheDocument();
    expect(screen.queryByText(/Nie udało się/)).not.toBeInTheDocument();
  });

  it("the section is present for an ORGANIZER too", async () => {
    mockOrganizerDefaults();
    vi.mocked(groupsApi.getMyAttendances).mockResolvedValue(mockAttendances);
    renderPanel();

    await screen.findByRole("heading", { name: "Zapisane zajęcia" });
    expect(await screen.findByRole("link", { name: /Nutki dla starszaków/ })).toBeInTheDocument();
  });
});

describe("PanelPage — Spotkania list links to the public circle page", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("each term row in the Spotkania list is a link (the whole tile) to the per-term public page, not the authenticated one", async () => {
    mockOrganizerDefaults();
    vi.mocked(termsApi.getTerms).mockResolvedValue([
      { id: 1, circle_group_id: 5, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "" },
    ]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Spotkania" }));

    const link = await screen.findByRole("link", { name: new RegExp(mockGroup.name) });
    expect(link).toHaveAttribute("href", `/${mockGroup.organizer_slug}/grupa/${mockGroup.id}/term/1`);
  });

  it("GUEST who only RSVP'd (never joined the Circle as a family member) still sees that session in Spotkania", async () => {
    // Regression: an RSVP on the public term page never creates a
    // `Membership` row, so the Circle-membership-based fetch alone
    // (`getMembershipsForFamily` -> `[]` here) must not be the only source
    // — the attendance itself has to surface here too, not just on Home's
    // "Zapisane zajęcia".
    mockGuestDefaults();
    vi.mocked(groupsApi.getMyAttendances).mockResolvedValue(mockAttendances);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Spotkania" }));

    const first = await screen.findByRole("link", { name: /Nutki dla starszaków/ });
    expect(first).toHaveAttribute("href", "/ania-kowalska/grupa/5/term/3");
    const second = screen.getByRole("link", { name: /Rytmika/ });
    expect(second).toHaveAttribute("href", "/basia-nowak/grupa/6/term/8");
  });

  it("ORGANIZER's own personal RSVP to someone else's Circle is not mixed into their 'Grupy'/'Terminy' management lists", async () => {
    // The merge above is GUEST-only by design: an ORGANIZER's `terms` here
    // is the single-purpose "Circles I organize" list (rename/delete-circle
    // actions read it) — their own RSVP elsewhere already has its own home
    // on Home's "Zapisane zajęcia" and must not duplicate into this view.
    mockOrganizerDefaults();
    vi.mocked(groupsApi.getMyAttendances).mockResolvedValue(mockAttendances);
    vi.mocked(termsApi.getTerms).mockResolvedValue([]);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Spotkania" }));

    // The organizer's own Circle ("Nowa grupa", from `mockGroup`) still
    // renders normally; the attendance-only Circle ("Nutki dla starszaków")
    // must not leak into this list.
    await screen.findByText("Nowa grupa", { selector: "h3" });
    expect(screen.queryByText(/Nutki dla starszaków/)).not.toBeInTheDocument();
  });
});

describe("PanelPage — per-term public links & copy-link button", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("organizer with no Organization — 'Terminy' row still links to the per-term public page via the hash slug", async () => {
    mockOrganizerDefaults();
    vi.mocked(groupsApi.getGroup).mockResolvedValue(mockGroupHashSlug);
    vi.mocked(groupsApi.getTermAttendeesForFormalization).mockResolvedValue([]);
    vi.mocked(termsApi.getTerms).mockResolvedValue([
      { id: 1, circle_group_id: 5, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "" },
    ]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Spotkania" }));

    const link = await screen.findByRole("link", { name: new RegExp(mockGroup.name) });
    expect(link).toHaveAttribute("href", `/${mockGroupHashSlug.organizer_slug}/grupa/${mockGroup.id}/term/1`);
  });

  it("organizer term tile marks a claimed needed item with a checkmark", async () => {
    mockOrganizerDefaults();
    vi.mocked(termsApi.getTerms).mockResolvedValue([
      { id: 1, circle_group_id: 5, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "" },
    ]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([
      {
        id: 1, term_id: 1, product_id: 5, product_name: "Bębenek",
        product_category_id: 5, product_category_name: "Inne", description: null, claimed: true, created_at: "", updated_at: "",
      },
      {
        id: 2, term_id: 1, product_id: 6, product_name: "Koc",
        product_category_id: 5, product_category_name: "Inne", description: null, claimed: false, created_at: "", updated_at: "",
      },
    ]);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Spotkania" }));

    expect(await screen.findByText("✓ Bębenek")).toBeInTheDocument();
    expect(screen.getByText("Koc")).toBeInTheDocument();
  });

  it("copy-link button on an organizer 'Terminy' row writes the absolute per-term URL and toasts", async () => {
    mockOrganizerDefaults();
    vi.mocked(termsApi.getTerms).mockResolvedValue([
      { id: 1, circle_group_id: 5, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "" },
    ]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Spotkania" }));

    const copyBtn = await screen.findByRole("button", { name: "Kopiuj link do terminu" });
    expect(copyBtn).not.toBeDisabled();
    fireEvent.click(copyBtn);

    expect(clipboardWriteText).toHaveBeenCalledWith(
      `${window.location.origin}/${mockGroup.organizer_slug}/grupa/${mockGroup.id}/term/1`,
    );
    expect(await screen.findByText("Skopiowano link")).toBeInTheDocument();
  });

  it("'Dodaj termin' dialog keeps 'Potrzebne rzeczy' collapsed behind a small optional button", async () => {
    mockOrganizerDefaults();
    vi.mocked(termsApi.getTerms).mockResolvedValue([]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Spotkania" }));
    fireEvent.click(await screen.findByRole("button", { name: "+ Dodaj termin" }));

    const dialog = await screen.findByRole("dialog", { name: "Dodaj termin zajęć" });
    expect(within(dialog).getByText("Potrzebne rzeczy (opcjonalnie)")).toBeInTheDocument();
    // form is not shown yet
    expect(within(dialog).queryByLabelText("Nazwa")).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "+ Dodaj potrzebną rzecz" }));
    expect(within(dialog).getByLabelText("Nazwa")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Dodaj rzecz" })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Zwiń" }));
    expect(within(dialog).queryByLabelText("Nazwa")).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "+ Dodaj potrzebną rzecz" }),
    ).toBeInTheDocument();
  });

  it("organizer first-term stepper done-screen CTA deep-links to the just-created term using the circle's slug", async () => {
    mockOrganizerDefaults();
    vi.mocked(termsApi.createTerm).mockResolvedValue({
      id: 7, circle_group_id: 5, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "",
    });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Dodaj termin →" }));

    const dialog = await screen.findByRole("dialog", { name: "Dodaj pierwszy termin" });
    fireEvent.change(await within(dialog).findByLabelText("Data i godzina"), { target: { value: "2026-02-01T17:00" } });

    vi.mocked(termsApi.getTerms).mockResolvedValue([
      { id: 7, circle_group_id: 5, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "" },
    ]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj termin" }));

    const publicLink = await within(dialog).findByRole("link", { name: /Przejdź do publicznej strony/ });
    expect(publicLink).toHaveAttribute("href", `/${mockGroup.organizer_slug}/grupa/5/term/7`);
  });
});

describe("PanelPage — needed item sub-CRUD (in the term dialog)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const term = {
    id: 1,
    circle_group_id: 5,
    occurs_on: "2026-02-01",
    description: "Zajęcia",
    created_at: "",
    updated_at: "",
  };
  const neededItem = {
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

  function mockTermWithNeeded() {
    mockOrganizerDefaults();
    vi.mocked(termsApi.getTerms).mockResolvedValue([term]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([neededItem]);
  }

  async function openEditDialog() {
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Spotkania" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Edytuj termin" }))[0]);
    return screen.findByRole("dialog", { name: "Edytuj termin" });
  }

  it("adds a needed item via the dialog add row (resolveProduct then createNeededItem)", async () => {
    mockTermWithNeeded();
    vi.mocked(productsApi.resolveProduct).mockResolvedValue({
      id: 42, name: "Mata", description: null, photoUrl: null, sku: "MATA-1",
      category_id: 1, pluginData: null, createdAt: "", updatedAt: "",
    });
    vi.mocked(termsApi.createNeededItem).mockResolvedValue({
      id: 12, term_id: 1, product_id: 42, product_name: "Mata", product_category_id: 1, product_category_name: "Zabawka",
      description: "Koc", claimed: false, created_at: "", updated_at: "",
    });
    const dialog = await openEditDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj potrzebną rzecz" }));
    fireEvent.change(within(dialog).getByLabelText("Nazwa nowej rzeczy"), { target: { value: "Mata" } });
    fireEvent.change(within(dialog).getByLabelText("Doprecyzowanie nowej rzeczy"), { target: { value: "Koc" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj" }));

    await waitFor(() =>
      expect(productsApi.resolveProduct).toHaveBeenCalledWith({ name: "Mata", category_id: 1 }),
    );
    await waitFor(() =>
      expect(termsApi.createNeededItem).toHaveBeenCalledWith({
        term_id: 1, product_id: 42, description: "Koc",
      }),
    );
  });

  it("edits a needed item's description only via the dialog (no resolveProduct)", async () => {
    mockTermWithNeeded();
    vi.mocked(termsApi.updateNeededItem).mockResolvedValue({ ...neededItem, description: "duży" });
    const dialog = await openEditDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "Edytuj potrzebną rzecz" }));
    fireEvent.change(within(dialog).getByLabelText("Doprecyzowanie rzeczy"), { target: { value: "duży" } });
    const row = within(dialog).getByRole("listitem");
    fireEvent.click(within(row).getByRole("button", { name: "Zapisz" }));

    await waitFor(() =>
      expect(termsApi.updateNeededItem).toHaveBeenCalledWith(11, { description: "duży" }),
    );
    expect(productsApi.resolveProduct).not.toHaveBeenCalled();
  });

  it("deletes a needed item via the dialog (await-then-refresh)", async () => {
    mockTermWithNeeded();
    vi.mocked(termsApi.deleteNeededItem).mockResolvedValue(undefined);
    const dialog = await openEditDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "Usuń potrzebną rzecz" }));

    await waitFor(() => expect(termsApi.deleteNeededItem).toHaveBeenCalledWith(11));
  });

  it("keeps the row and shows an inline message when delete returns 409", async () => {
    mockTermWithNeeded();
    vi.mocked(termsApi.deleteNeededItem).mockRejectedValue(Object.assign(new Error("409"), { status: 409 }));
    const dialog = await openEditDialog();

    expect(within(dialog).getByText(/Bębenek/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Usuń potrzebną rzecz" }));

    expect(await within(dialog).findByText(/Nie udało się usunąć/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Bębenek/)).toBeInTheDocument();
  });
});

describe("PanelPage — inventory item edit/delete", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const invItem = {
    id: 21,
    inventory_id: 1,
    home_inventory_id: null,
    product_id: 7,
    product_name: "Rowerek",
    condition: "GOOD" as const,
    added_at: "",
    created_at: "",
    updated_at: "",
  };
  const product = {
    id: 7,
    name: "Rowerek",
    description: null,
    photoUrl: null,
    sku: "SKU7",
    category_id: 1,
    pluginData: null,
    createdAt: "",
    updatedAt: "",
  };

  function mockItems() {
    mockGuestDefaults();
    vi.mocked(inventoriesApi.getInventoryItems).mockResolvedValue([invItem]);
    vi.mocked(productsApi.getProducts).mockResolvedValue([product]);
  }

  it("edits an item's condition inline in 'Moje rzeczy'", async () => {
    mockItems();
    vi.mocked(inventoriesApi.updateInventoryItem).mockResolvedValue({ ...invItem, condition: "NEW" });
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Moje rzeczy" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edytuj stan rzeczy" }));
    fireEvent.change(screen.getByLabelText("Stan rzeczy"), { target: { value: "NEW" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    await waitFor(() =>
      expect(inventoriesApi.updateInventoryItem).toHaveBeenCalledWith(21, { condition: "NEW" }),
    );
  });

  it("edits an item name+category → resolveProduct then updateInventoryItem with the new product_id", async () => {
    mockItems();
    vi.mocked(productsApi.resolveProduct).mockResolvedValue({ ...product, id: 99, name: "Hulajnoga" });
    vi.mocked(inventoriesApi.updateInventoryItem).mockResolvedValue({ ...invItem, product_id: 99 });
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Moje rzeczy" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edytuj rzecz Rowerek" }));
    fireEvent.change(screen.getByLabelText("Nazwa rzeczy"), { target: { value: "Hulajnoga" } });
    fireEvent.change(screen.getByLabelText("Typ rzeczy"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    await waitFor(() =>
      expect(productsApi.resolveProduct).toHaveBeenCalledWith({ name: "Hulajnoga", category_id: 3 }),
    );
    await waitFor(() =>
      expect(inventoriesApi.updateInventoryItem).toHaveBeenCalledWith(21, { product_id: 99 }),
    );
  });

  it("shows an inline error when the item name save is rejected", async () => {
    mockItems();
    vi.mocked(productsApi.resolveProduct).mockRejectedValue(new Error("500"));
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Moje rzeczy" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edytuj rzecz Rowerek" }));
    fireEvent.change(screen.getByLabelText("Nazwa rzeczy"), { target: { value: "Hulajnoga" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    expect(await screen.findByText(/Nie udało się zapisać zmian/)).toBeInTheDocument();
  });

  it("optimistically deletes an item and restores it on a 409", async () => {
    mockItems();
    vi.mocked(inventoriesApi.deleteInventoryItem).mockRejectedValue(
      Object.assign(new Error("409"), { status: 409 }),
    );
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Moje rzeczy" }));
    expect(await screen.findByText("Rowerek")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Usuń rzecz Rowerek" }));

    expect(screen.getByRole("status")).toHaveTextContent("Usunięto");
    expect(await screen.findByText(/Nie udało się usunąć/)).toBeInTheDocument();
    expect(screen.getByText("Rowerek")).toBeInTheDocument();
  });
});

describe("PanelPage — needed item edit error path", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const term = {
    id: 1,
    circle_group_id: 5,
    occurs_on: "2026-02-01",
    description: "Zajęcia",
    created_at: "",
    updated_at: "",
  };
  const neededItem = {
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

  it("shows an inline error and keeps the original needed item when the edit is rejected", async () => {
    mockOrganizerDefaults();
    vi.mocked(termsApi.getTerms).mockResolvedValue([term]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([neededItem]);
    vi.mocked(termsApi.updateNeededItem).mockRejectedValue(new Error("500"));
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Spotkania" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Edytuj termin" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Edytuj termin" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Edytuj potrzebną rzecz" }));
    fireEvent.change(within(dialog).getByLabelText("Doprecyzowanie rzeczy"), {
      target: { value: "Coś innego" },
    });
    const row = within(dialog).getByRole("listitem");
    fireEvent.click(within(row).getByRole("button", { name: "Zapisz" }));

    expect(await within(dialog).findByText(/Nie udało się zapisać zmiany/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Bębenek/)).toBeInTheDocument();
  });
});

describe("PanelPage — Zadeklarowane rzeczy (my pledges)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const myPledge: pledgesApi.MyPledgeResponse = {
    pledge_id: 7,
    status: "CLAIMED",
    product_name: "Bębenek",
    item_description: "mały",
    term_id: 3,
    group_id: 5,
    group_name: "Nutki",
    occurs_on: "2026-03-12T17:30:00",
    organizer_slug: "ania",
    registered: false,
  };

  it("renders a declared item and 'Rezygnuję' calls withdrawPledge then reloads", async () => {
    mockGuestDefaults();
    vi.mocked(pledgesApi.getMyPledges).mockResolvedValueOnce([myPledge]).mockResolvedValue([]);
    vi.mocked(pledgesApi.withdrawPledge).mockResolvedValue({
      id: 7,
      needed_item_id: 1,
      pledged_by_party_id: 1,
      status: "WITHDRAWN",
      resolved_reservation_id: null,
      created_at: "",
      updated_at: "",
    });
    renderPanel();

    expect(await screen.findByRole("heading", { name: "Zadeklarowane rzeczy" })).toBeInTheDocument();
    expect(screen.getByText(/Bębenek/)).toBeInTheDocument();
    expect(screen.getByText(/Nutki/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Rezygnuję" }));
    await waitFor(() => expect(pledgesApi.withdrawPledge).toHaveBeenCalledWith(7));
  });

  it("shows the empty state when there are no pledges", async () => {
    mockGuestDefaults();
    renderPanel();

    expect(
      await screen.findByText("Nie zadeklarowałeś jeszcze przyniesienia żadnej rzeczy."),
    ).toBeInTheDocument();
  });

  it("hides 'Rezygnuję' once the item is registered", async () => {
    mockGuestDefaults();
    vi.mocked(pledgesApi.getMyPledges).mockResolvedValue([{ ...myPledge, registered: true }]);
    renderPanel();

    expect(await screen.findByText(/Bębenek/)).toBeInTheDocument();
    expect(screen.getByText(/Zarejestrowane/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rezygnuję" })).not.toBeInTheDocument();
  });
});

describe("PanelPage — notification bell", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const notif = (over: Partial<notificationsApi.NotificationResponse> = {}) => ({
    id: 1,
    kind: "PLEDGE_CREATED" as const,
    message: "„Kasia\" zadeklarował(a) przyniesienie: Bębenek",
    link_path: "/ania/grupa/5/term/3",
    read_at: null,
    created_at: "2026-03-01T10:00:00",
    ...over,
  });

  it("shows an unread badge and lists messages in the dropdown", async () => {
    mockGuestDefaults();
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([notif(), notif({ id: 2 })]);
    renderPanel();

    const bell = await screen.findByRole("button", {
      name: /Powiadomienia \(2 nieprzeczytane\)/,
    });
    fireEvent.click(bell);

    expect(
      screen.getAllByText(/zadeklarował\(a\) przyniesienie: Bębenek/).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("clicking a notification marks it read and navigates to its link_path", async () => {
    mockGuestDefaults();
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([notif()]);
    vi.mocked(notificationsApi.markNotificationRead).mockResolvedValue(undefined);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: /Powiadomienia/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /zadeklarował\(a\)/ }));

    await waitFor(() => expect(notificationsApi.markNotificationRead).toHaveBeenCalledWith(1));
  });

  it("'Oznacz jako przeczytane' calls markAllNotificationsRead", async () => {
    mockGuestDefaults();
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([notif()]);
    vi.mocked(notificationsApi.markAllNotificationsRead).mockResolvedValue(undefined);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: /Powiadomienia/ }));
    fireEvent.click(screen.getByRole("button", { name: "Oznacz jako przeczytane" }));

    await waitFor(() => expect(notificationsApi.markAllNotificationsRead).toHaveBeenCalled());
  });

  it("shows no badge when everything is read", async () => {
    mockGuestDefaults();
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([
      notif({ read_at: "2026-03-02T09:00:00" }),
    ]);
    renderPanel();

    expect(await screen.findByRole("button", { name: "Powiadomienia" })).toBeInTheDocument();
  });
});

describe("TermPage (private view) — Group 7 swap-offer dialog", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    kragHookValue = baseKragHookValue();
    // TermPage now also fetches the caller's own taken listings
    // directly (getMyTakenTermItemListings, Group 4) independent of the
    // mocked useKragGrupy's browseListings — default to empty so these
    // swap-offer-dialog tests (which don't care about it) don't hit an
    // unresolved vi.fn().
    vi.mocked(termItemListingsApi.getMyTakenTermItemListings).mockResolvedValue([]);
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue({
      group: { ...mockGroup, organizer_display_name: "Ola", organizer_slug: "ola", next_term: null, guardians: [] },
      access: { is_member: true, is_organizer: true, can_view_content: true, can_join: false },
    });
  });

  it("renders a single-item picker (not the old bare select-with-no-context) with a 'Twoja rzecz X za ich rzecz Y' preview, and Zaproponuj zamianę calls takeOrProposeExchange with the chosen item", async () => {
    const takeOrProposeExchange = vi.fn().mockResolvedValue(undefined);
    kragHookValue = baseKragHookValue({
      browseListings: [browseListing({ id: 501, product_name: "Rowerek" })],
      myAvailableItems: [{ id: 500, productName: "Autko" }],
      mySwapAvailableItems: [{ id: 500, productName: "Autko" }],
      takeOrProposeExchange,
    });
    renderKrag();

    fireEvent.click(await screen.findByRole("button", { name: "Zamień: Rowerek" }));

    // exactly one single-item picker — no multi-select checkboxes anywhere.
    expect(screen.getByRole("combobox", { name: "Twoja rzecz do zamiany" })).toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    // the trade preview — "Twoja rzecz Autko za ich rzecz Rowerek" — is one
    // paragraph's full text (matched as a whole so it doesn't collide with
    // the identically-worded <option>/row-title text elsewhere on the page).
    expect(
      screen.getByText((_, el) => (el?.textContent ?? "").trim() === "Twoja rzecz Autko za ich rzecz Rowerek"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Zaproponuj zamianę" }));

    await waitFor(() => expect(takeOrProposeExchange).toHaveBeenCalledWith(501, "SWAP", 500));
  });

  it("a plain LEND take (not SWAP) still calls takeOrProposeExchange directly, with no dialog involved", async () => {
    const takeOrProposeExchange = vi.fn().mockResolvedValue(undefined);
    kragHookValue = baseKragHookValue({
      browseListings: [browseListing({ id: 502, product_name: "Klocki", offered_types: ["LEND"] })],
      takeOrProposeExchange,
    });
    renderKrag();

    fireEvent.click(await screen.findByRole("button", { name: "Pożycz: Klocki" }));

    await waitFor(() => expect(takeOrProposeExchange).toHaveBeenCalledWith(502, "LEND", undefined));
    expect(screen.queryByRole("combobox", { name: "Twoja rzecz do zamiany" })).not.toBeInTheDocument();
  });
});

describe("PanelPage — Group 7 global pending-actions modal", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  function pendingNotif(
    over: Partial<notificationsApi.NotificationResponse> = {},
  ): notificationsApi.NotificationResponse {
    return {
      id: 1,
      kind: "SWAP_PROPOSED",
      message: '„Marek" proponuje zamianę za: Rowerek',
      link_path: "/ania/grupa/5/term/3",
      read_at: null,
      created_at: "2026-03-01T10:00:00",
      ...over,
    };
  }

  it("renders an incoming swap accept/reject prompt fed from pendingActions; 'Zobacz i zdecyduj' marks it read and clears it from the modal", async () => {
    mockGuestDefaults();
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([pendingNotif()]);
    vi.mocked(notificationsApi.markNotificationRead).mockResolvedValue(undefined);
    renderPanel();

    const dialog = await screen.findByRole("dialog", { name: "Propozycja zamiany" });
    expect(within(dialog).getByText(/proponuje zamianę/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Zobacz i zdecyduj" }));

    await waitFor(() => expect(notificationsApi.markNotificationRead).toHaveBeenCalledWith(1));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Propozycja zamiany" })).not.toBeInTheDocument(),
    );
  });

  // Group 9 gap fix: once the notification carries a real `proposal_id`,
  // the modal calls acceptSwapProposal/rejectSwapProposal directly instead
  // of only offering the "Zobacz i zdecyduj" deep-link fallback above.
  it("with a proposal_id present, offers Akceptuj/Odrzuć and accepting calls acceptSwapProposal directly (no navigation)", async () => {
    mockGuestDefaults();
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([
      pendingNotif({ proposal_id: 42 }),
    ]);
    vi.mocked(notificationsApi.markNotificationRead).mockResolvedValue(undefined);
    vi.mocked(termItemListingsApi.acceptSwapProposal).mockResolvedValue({
      id: 42,
      proposer_party_id: 1,
      listing_item_id: 500,
      offered_item_id: 501,
      proposer_reservation_id: 900,
      status: "ACCEPTED",
      created_at: "",
      updated_at: "",
    });
    renderPanel();

    const initialItemsCalls = vi.mocked(inventoriesApi.getInventoryItems).mock.calls.length;
    const dialog = await screen.findByRole("dialog", { name: "Propozycja zamiany" });
    expect(within(dialog).queryByRole("button", { name: "Zobacz i zdecyduj" })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Akceptuj" }));

    await waitFor(() => expect(termItemListingsApi.acceptSwapProposal).toHaveBeenCalledWith(42));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Propozycja zamiany" })).not.toBeInTheDocument(),
    );
    // Cache-refresh bug (same class as confirmPendingAction/Bug #3):
    // accepting a swap locks/reassigns items, so "Moje rzeczy" must
    // silently re-fetch rather than showing stale data until reload.
    await waitFor(() =>
      expect(vi.mocked(inventoriesApi.getInventoryItems).mock.calls.length).toBeGreaterThan(
        initialItemsCalls,
      ),
    );
  });

  it("with a proposal_id present, rejecting calls rejectSwapProposal directly and clears the modal", async () => {
    mockGuestDefaults();
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([
      pendingNotif({ proposal_id: 43 }),
    ]);
    vi.mocked(notificationsApi.markNotificationRead).mockResolvedValue(undefined);
    vi.mocked(termItemListingsApi.rejectSwapProposal).mockResolvedValue({
      id: 43,
      proposer_party_id: 1,
      listing_item_id: 500,
      offered_item_id: 501,
      proposer_reservation_id: 900,
      status: "REJECTED",
      created_at: "",
      updated_at: "",
    });
    renderPanel();

    const initialItemsCalls = vi.mocked(inventoriesApi.getInventoryItems).mock.calls.length;
    const dialog = await screen.findByRole("dialog", { name: "Propozycja zamiany" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Odrzuć" }));

    await waitFor(() => expect(termItemListingsApi.rejectSwapProposal).toHaveBeenCalledWith(43));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Propozycja zamiany" })).not.toBeInTheDocument(),
    );
    // Same cache-refresh fix as accepting: rejecting releases the
    // proposer's self-locked item back to AVAILABLE, which "Moje rzeczy"
    // must reflect without a manual reload.
    await waitFor(() =>
      expect(vi.mocked(inventoriesApi.getInventoryItems).mock.calls.length).toBeGreaterThan(
        initialItemsCalls,
      ),
    );
  });

  it("a swap proposal's accept attempt that lost the confirm race shows the 'already resolved' message", async () => {
    mockGuestDefaults();
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([
      pendingNotif({ proposal_id: 44 }),
    ]);
    vi.mocked(termItemListingsApi.acceptSwapProposal).mockRejectedValue(
      new ApiError(409, "Conflict", { already_resolved: true }),
    );
    renderPanel();

    const dialog = await screen.findByRole("dialog", { name: "Propozycja zamiany" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Akceptuj" }));

    expect(
      await within(dialog).findByText("Transakcja została już rozstrzygnięta przez drugą stronę."),
    ).toBeInTheDocument();
  });

  it("renders a post-term-end confirm prompt for TERM_CONFIRMATION_NEEDED, and confirming resolves the reservation id from the term's listings then calls confirmTransaction", async () => {
    mockGuestDefaults();
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([
      pendingNotif({
        id: 2,
        kind: "TERM_CONFIRMATION_NEEDED",
        message: "Termin się odbył — potwierdź przekazanie rzeczy",
        link_path: "/ania/grupa/5/term/9",
      }),
    ]);
    vi.mocked(termItemListingsApi.getMyTakenTermItemListings).mockResolvedValue([
      browseListing({ id: 9, taken_by_party_id: mockProfile.party_id, resolved_reservation_id: 77 }),
    ]);
    vi.mocked(termItemListingsApi.getMyTermItemListings).mockResolvedValue([]);
    vi.mocked(reservationsApi.getReservation).mockResolvedValue({
      id: 77,
      item_id: 9,
      reservation_type: "GIFT",
      reserved_by_user_id: 1,
      paired_reservation_id: null,
      reserved_at: "",
      expires_at: null,
      status: "PENDING",
      notes: null,
    });
    vi.mocked(reservationsApi.confirmTransaction).mockResolvedValue({
      reservation_id: 77,
      status: "FULFILLED",
      already_resolved: false,
    });
    renderPanel();

    const dialog = await screen.findByRole("dialog", { name: "Potwierdź transakcję" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Potwierdź" }));

    await waitFor(() =>
      expect(reservationsApi.confirmTransaction).toHaveBeenCalledWith(77, { term_id: 9 }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Potwierdź transakcję" })).not.toBeInTheDocument(),
    );
  });

  // Bug #3 (cache refresh, frontend-only): confirmPendingAction previously
  // dismissed the notification without re-fetching panel data, so a stale
  // "Moje rzeczy"/pledges view could linger after a confirm. Matches every
  // other mutation handler's `await load({ silent: true })` convention
  // (e.g. withdrawMyPledge).
  it("confirming a pending TERM_CONFIRMATION_NEEDED action triggers a silent panel data refresh after confirmTransaction succeeds", async () => {
    mockGuestDefaults();
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([
      pendingNotif({
        id: 2,
        kind: "TERM_CONFIRMATION_NEEDED",
        message: "Termin się odbył — potwierdź przekazanie rzeczy",
        link_path: "/ania/grupa/5/term/9",
      }),
    ]);
    vi.mocked(termItemListingsApi.getMyTakenTermItemListings).mockResolvedValue([
      browseListing({ id: 9, taken_by_party_id: mockProfile.party_id, resolved_reservation_id: 77 }),
    ]);
    vi.mocked(termItemListingsApi.getMyTermItemListings).mockResolvedValue([]);
    vi.mocked(reservationsApi.getReservation).mockResolvedValue({
      id: 77,
      item_id: 9,
      reservation_type: "GIFT",
      reserved_by_user_id: 1,
      paired_reservation_id: null,
      reserved_at: "",
      expires_at: null,
      status: "PENDING",
      notes: null,
    });
    vi.mocked(reservationsApi.confirmTransaction).mockResolvedValue({
      reservation_id: 77,
      status: "FULFILLED",
      already_resolved: false,
    });
    renderPanel();

    const dialog = await screen.findByRole("dialog", { name: "Potwierdź transakcję" });
    await waitFor(() => expect(inventoriesApi.getInventoryItems).toHaveBeenCalledTimes(1));

    fireEvent.click(within(dialog).getByRole("button", { name: "Potwierdź" }));

    await waitFor(() =>
      expect(reservationsApi.confirmTransaction).toHaveBeenCalledWith(77, { term_id: 9 }),
    );
    // A second `getInventoryItems` call is the signal that `load({ silent: true })`
    // re-ran after the confirm, not just `dismissPendingAction`.
    await waitFor(() => expect(inventoriesApi.getInventoryItems).toHaveBeenCalledTimes(2));
  });

  // Bug #3 (cache refresh, structural fix): PanelDataContext gains a
  // route-watching effect (useLocation) that silently reloads panel data
  // whenever the pathname transitions onto a /panel/* route — so a
  // confirmation made from the term page (TermPage) is reflected once
  // the user navigates back to the panel, without needing a manual refresh.
  it("silently reloads panel data on re-entry to a /panel/* route after navigating away and back", async () => {
    mockGuestDefaults();
    renderPanelWithNavigation();

    await waitFor(() => expect(peopleApi.getMyProfile).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Wyjdź z panelu" }));
    expect(await screen.findByText("Poza panelem")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Wróć do panelu" }));

    await waitFor(() =>
      expect(vi.mocked(peopleApi.getMyProfile).mock.calls.length).toBeGreaterThan(1),
    );
  });

  // TDD red gate (2026-09-17-fix-giveaway-exchange), now fixed: this test
  // reproduces the realistic post-term-end backend contract —
  // list_browsable_term_item_listings short-circuits to `[]` once
  // `term.occurs_on < now()` (see backend
  // test_browseListing_termOccursOnInPast_becomesUnbrowsable), which is
  // exactly the moment TERM_CONFIRMATION_NEEDED fires — while
  // resolvePendingReservationId's taker-side lookup now resolves the
  // reservation id via getMyTakenTermItemListings instead, which is not
  // availability-filtered and so still works post-term-end.
  it("resolves a GIFT reservation id for the taker even when the term has already ended (realistic empty browse response)", async () => {
    mockGuestDefaults();
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([
      pendingNotif({
        id: 2,
        kind: "TERM_CONFIRMATION_NEEDED",
        message: "Termin się odbył — potwierdź przekazanie rzeczy",
        link_path: "/ania/grupa/5/term/9",
      }),
    ]);
    // Realistic post-term-end backend response: browse listings are empty
    // once the term has occurred, per list_browsable_term_item_listings.
    vi.mocked(termItemListingsApi.getBrowseTermItemListings).mockResolvedValue([]);
    vi.mocked(termItemListingsApi.getMyTermItemListings).mockResolvedValue([]);
    // getMyTakenTermItemListings is availability-independent, so it still
    // returns the taken row after the term has occurred.
    vi.mocked(termItemListingsApi.getMyTakenTermItemListings).mockResolvedValue([
      browseListing({ id: 9, taken_by_party_id: mockProfile.party_id, resolved_reservation_id: 77 }),
    ]);
    vi.mocked(reservationsApi.getReservation).mockResolvedValue({
      id: 77,
      item_id: 9,
      reservation_type: "GIFT",
      reserved_by_user_id: 1,
      paired_reservation_id: null,
      reserved_at: "",
      expires_at: null,
      status: "PENDING",
      notes: null,
    });
    vi.mocked(reservationsApi.confirmTransaction).mockResolvedValue({
      reservation_id: 77,
      status: "FULFILLED",
      already_resolved: false,
    });
    renderPanel();

    const dialog = await screen.findByRole("dialog", { name: "Potwierdź transakcję" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Potwierdź" }));

    await waitFor(() =>
      expect(reservationsApi.confirmTransaction).toHaveBeenCalledWith(77, { term_id: 9 }),
    );
  });

  it("confirming a race after losing it shows the distinct 'already resolved' message instead of a generic error", async () => {
    mockGuestDefaults();
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([
      pendingNotif({
        id: 2,
        kind: "TERM_CONFIRMATION_NEEDED",
        message: "Termin się odbył — potwierdź przekazanie rzeczy",
        link_path: "/ania/grupa/5/term/9",
      }),
    ]);
    vi.mocked(termItemListingsApi.getMyTakenTermItemListings).mockResolvedValue([
      browseListing({ id: 9, taken_by_party_id: mockProfile.party_id, resolved_reservation_id: 77 }),
    ]);
    vi.mocked(termItemListingsApi.getMyTermItemListings).mockResolvedValue([]);
    vi.mocked(reservationsApi.getReservation).mockResolvedValue({
      id: 77,
      item_id: 9,
      reservation_type: "GIFT",
      reserved_by_user_id: 1,
      paired_reservation_id: null,
      reserved_at: "",
      expires_at: null,
      status: "PENDING",
      notes: null,
    });
    vi.mocked(reservationsApi.confirmTransaction).mockRejectedValue(
      new ApiError(409, "Conflict", { reservation_id: 77, status: "ALREADY_RESOLVED", already_resolved: true }),
    );
    renderPanel();

    const dialog = await screen.findByRole("dialog", { name: "Potwierdź transakcję" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Potwierdź" }));

    expect(
      await within(dialog).findByText("Transakcja została już rozstrzygnięta przez drugą stronę."),
    ).toBeInTheDocument();
    // distinct from a generic error toast — the dialog itself stays open,
    // now offering only "Zamknij" instead of "Potwierdź" again.
    expect(within(dialog).queryByRole("button", { name: "Potwierdź" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Rozumiem" })).toBeInTheDocument();
  });

  // Group 4 (2026-09-17-fix-giveaway-exchange): the GIFT/LEND owner/lister
  // side is symmetric to the existing SWAP paired-leg branch below —
  // resolvePendingReservationId resolves the caller's own reservation id
  // directly (no paired leg to look up) when the caller listed the item.
  it("resolves a GIFT reservation id for the owner/lister side directly, post-term-end", async () => {
    mockGuestDefaults();
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([
      pendingNotif({
        id: 2,
        kind: "TERM_CONFIRMATION_NEEDED",
        message: "Termin się odbył — potwierdź przekazanie rzeczy",
        link_path: "/ania/grupa/5/term/9",
      }),
    ]);
    // Taker side finds nothing — the caller is the lister here.
    vi.mocked(termItemListingsApi.getMyTakenTermItemListings).mockResolvedValue([]);
    vi.mocked(termItemListingsApi.getMyTermItemListings).mockResolvedValue([
      browseListing({ id: 9, lister_party_id: mockProfile.party_id, resolved_reservation_id: 55 }),
    ]);
    vi.mocked(reservationsApi.getReservation).mockResolvedValue({
      id: 55,
      item_id: 9,
      reservation_type: "GIFT",
      reserved_by_user_id: 2,
      paired_reservation_id: null,
      reserved_at: "",
      expires_at: null,
      status: "PENDING",
      notes: null,
    });
    vi.mocked(reservationsApi.confirmTransaction).mockResolvedValue({
      reservation_id: 55,
      status: "FULFILLED",
      already_resolved: false,
    });
    renderPanel();

    const dialog = await screen.findByRole("dialog", { name: "Potwierdź transakcję" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Potwierdź" }));

    await waitFor(() =>
      expect(reservationsApi.confirmTransaction).toHaveBeenCalledWith(55, { term_id: 9 }),
    );
  });

  // Regression: the pre-existing SWAP paired-leg resolution branch (owner
  // side of an accepted SWAP resolves via the paired leg, not primary.id
  // directly) must remain unchanged by the GIFT/LEND addition above.
  it("still resolves the SWAP paired-leg reservation id for the owner side, unchanged", async () => {
    mockGuestDefaults();
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([
      pendingNotif({
        id: 2,
        kind: "TERM_CONFIRMATION_NEEDED",
        message: "Termin się odbył — potwierdź przekazanie rzeczy",
        link_path: "/ania/grupa/5/term/9",
      }),
    ]);
    vi.mocked(termItemListingsApi.getMyTakenTermItemListings).mockResolvedValue([]);
    vi.mocked(termItemListingsApi.getMyTermItemListings).mockResolvedValue([
      browseListing({ id: 9, lister_party_id: mockProfile.party_id, resolved_reservation_id: 60 }),
    ]);
    vi.mocked(reservationsApi.getReservation).mockImplementation(async (id: number) => {
      if (id === 60) {
        return {
          id: 60,
          item_id: 9,
          reservation_type: "SWAP",
          reserved_by_user_id: 2,
          paired_reservation_id: 61,
          reserved_at: "",
          expires_at: null,
          status: "PENDING",
          notes: null,
        };
      }
      return {
        id: 61,
        item_id: 12,
        reservation_type: "SWAP",
        reserved_by_user_id: 1,
        paired_reservation_id: 60,
        reserved_at: "",
        expires_at: null,
        status: "PENDING",
        notes: null,
      };
    });
    vi.mocked(reservationsApi.confirmTransaction).mockResolvedValue({
      reservation_id: 61,
      status: "FULFILLED",
      already_resolved: false,
    });
    renderPanel();

    const dialog = await screen.findByRole("dialog", { name: "Potwierdź transakcję" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Potwierdź" }));

    await waitFor(() =>
      expect(reservationsApi.confirmTransaction).toHaveBeenCalledWith(61, { term_id: 9 }),
    );
  });

  // Neither the taker side nor the owner/lister side resolves an ACTIVE
  // reservation for this caller — resolvePendingReservationId returns null.
  // Since this party only ever gets a TERM_CONFIRMATION_NEEDED notification
  // for a reservation that WAS active at notification-creation time, null
  // here means the other party already confirmed it in the meantime, not
  // "nothing to confirm" — the modal must show the same "already resolved"
  // state as a 409 from the backend (bug: it used to show an unhelpful
  // "not found" toast and leave the notification stuck, un-dismissed, so it
  // kept reappearing).
  it("treats a null reservation id as already-resolved-by-the-other-party, not 'not found'", async () => {
    mockGuestDefaults();
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([
      pendingNotif({
        id: 2,
        kind: "TERM_CONFIRMATION_NEEDED",
        message: "Termin się odbył — potwierdź przekazanie rzeczy",
        link_path: "/ania/grupa/5/term/9",
      }),
    ]);
    vi.mocked(termItemListingsApi.getMyTakenTermItemListings).mockResolvedValue([]);
    vi.mocked(termItemListingsApi.getMyTermItemListings).mockResolvedValue([]);
    vi.mocked(notificationsApi.markNotificationRead).mockResolvedValue(undefined);
    renderPanel();

    const dialog = await screen.findByRole("dialog", { name: "Potwierdź transakcję" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Potwierdź" }));

    expect(
      await within(dialog).findByText("Transakcja została już rozstrzygnięta przez drugą stronę."),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Potwierdź" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Rozumiem" })).toBeInTheDocument();
    expect(reservationsApi.confirmTransaction).not.toHaveBeenCalled();
    expect(reservationsApi.getReservation).not.toHaveBeenCalled();

    // "Rozumiem" dismisses the notification (marks it read) instead of
    // leaving it stuck so the modal reappears on every reload.
    fireEvent.click(within(dialog).getByRole("button", { name: "Rozumiem" }));
    await waitFor(() =>
      expect(notificationsApi.markNotificationRead).toHaveBeenCalledWith(2),
    );
  });

  it("read notifications never surface as pending actions — only the unread TERM_CONFIRMATION_NEEDED one renders", async () => {
    mockGuestDefaults();
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([
      pendingNotif({ id: 1, read_at: "2026-03-01T11:00:00" }),
      pendingNotif({
        id: 2,
        kind: "TERM_CONFIRMATION_NEEDED",
        message: "Termin się odbył — potwierdź przekazanie rzeczy",
        link_path: "/ania/grupa/5/term/9",
      }),
    ]);
    renderPanel();

    expect(await screen.findByRole("dialog", { name: "Potwierdź transakcję" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Propozycja zamiany" })).not.toBeInTheDocument();
  });

  it("the modal renders regardless of the currently active Panel section (home vs. rzeczy)", async () => {
    mockGuestDefaults();
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([pendingNotif()]);
    renderPanel();

    await screen.findByRole("dialog", { name: "Propozycja zamiany" });

    fireEvent.click(await screen.findByRole("button", { name: "Moje rzeczy" }));
    await screen.findByRole("heading", { name: "Moje rzeczy" });

    expect(screen.getByRole("dialog", { name: "Propozycja zamiany" })).toBeInTheDocument();
  });
});

describe("PanelPage — RzeczyView post-term-end fallback buttons (Bug #4c, full flow)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const lockedItem = {
    id: 30,
    inventory_id: 1,
    home_inventory_id: null,
    product_id: 8,
    product_name: "Wiertarka",
    condition: "GOOD" as const,
    added_at: "",
    created_at: "",
    updated_at: "",
  };

  it("dismissing the global confirm prompt still leaves the tile's own 'Odebrał' fallback usable — clicking it confirms the transaction and silently refreshes the panel", async () => {
    mockGuestDefaults();
    vi.mocked(inventoriesApi.getInventoryItems).mockResolvedValue([lockedItem]);
    vi.mocked(inventoriesApi.getInventoryItemBalances).mockResolvedValue({
      [lockedItem.id]: { status: "IN_TRANSIT", reservationId: 88 },
    });
    vi.mocked(reservationsApi.getReservation).mockResolvedValue({
      id: 88,
      item_id: lockedItem.id,
      reservation_type: "LEND",
      reserved_by_user_id: 1,
      term_id: 9,
      paired_reservation_id: null,
      reserved_at: "",
      expires_at: null,
      status: "CONFIRMED",
      notes: null,
    });
    vi.mocked(termsApi.getTerm).mockResolvedValue({
      id: 9,
      circle_group_id: 5,
      occurs_on: "2020-01-01T10:00:00", // long past — term has ended
      description: null,
      created_at: "",
      updated_at: "",
    });
    // A TERM_CONFIRMATION_NEEDED prompt also happens to be pending (e.g.
    // for a different reservation) — dismissing it via "Później" must not
    // interfere with the independent, tile-local fallback below.
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([
      {
        id: 1,
        kind: "TERM_CONFIRMATION_NEEDED",
        message: "Termin się odbył — potwierdź przekazanie rzeczy",
        link_path: "/ania/grupa/5/term/9",
        read_at: null,
        created_at: "2026-03-01T10:00:00",
      },
    ]);
    vi.mocked(notificationsApi.markNotificationRead).mockResolvedValue(undefined);
    vi.mocked(reservationsApi.confirmTransaction).mockResolvedValue({
      reservation_id: 88,
      status: "FULFILLED",
      already_resolved: false,
    });
    renderPanel();

    const dialog = await screen.findByRole("dialog", { name: "Potwierdź transakcję" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Później" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Potwierdź transakcję" })).not.toBeInTheDocument(),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Moje rzeczy" }));
    await waitFor(() => expect(inventoriesApi.getInventoryItems).toHaveBeenCalledTimes(1));

    const odebral = await screen.findByRole("button", { name: "Odebrał" });
    fireEvent.click(odebral);

    await waitFor(() =>
      expect(reservationsApi.confirmTransaction).toHaveBeenCalledWith(88, { term_id: 9 }),
    );
    // A second `getInventoryItems` call is the signal that `load({ silent:
    // true })` re-ran after the confirm (same convention as Bug #3's own
    // TERM_CONFIRMATION_NEEDED refresh test above).
    await waitFor(() => expect(inventoriesApi.getInventoryItems).toHaveBeenCalledTimes(2));
  });
});
