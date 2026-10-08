import { act, render, screen, waitFor, within } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";

// TODO(Group 8): this unit suite can only exercise the hamburger-promotion
// click-through and item-dialog rework at the component level — if the
// project wires up Playwright, add an end-to-end pass over the full GUEST
// "Chcę dodać krąg" → submit → organizer-view flow there.

import * as peopleApi from "../api/people";
import * as familiesApi from "../api/families";
import * as groupsApi from "../api/groups";
import type { BrowseTermItemListingResponse } from "../api/termItemListings";
import * as inventoriesApi from "../api/inventories";
import * as productsApi from "../api/products";
import * as termsApi from "../api/terms";
import * as organizationsApi from "../api/organizations";
import * as pledgesApi from "../api/pledges";
import * as notificationsApi from "../api/notifications";
import * as categoriesApi from "../api/categories";
import * as termItemListingsApi from "../api/termItemListings";
import * as reservationsApi from "../api/reservations";
import * as itemListingPreferencesApi from "../api/itemListingPreferences";
import { PanelPage } from "../pages/panel/PanelPage";
import { NotificationBell } from "../components/shared/NotificationBell";
import { ApiError } from "../api/client";
import { createQueryWrapper } from "./queryClient";
import { approxAge, formatApproxAge } from "../utils/age";

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
  getProfileByAccountUserId: vi.fn(),
  getLeadershipsForPerson: vi.fn(),
  updateMyProfile: vi.fn(),
  uploadMyAvatar: vi.fn(),
  deleteMyAvatar: vi.fn(),
}));

vi.mock("../api/families", () => ({
  getMyFamilies: vi.fn(),
  getMembershipsForFamily: vi.fn(),
  getGuardians: vi.fn(),
  createLightweightMembers: vi.fn(),
  createOwnFamily: vi.fn(),
  renameFamily: vi.fn(),
  removeFamilyMember: vi.fn(),
  updateChildBirthYear: vi.fn(),
}));

vi.mock("../api/groups", () => ({
  createMyCircle: vi.fn(),
  createAdditionalMyCircle: vi.fn(),
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
  // The panel's `load()` fetches the organizer's pending join requests on
  // every (silent) reload — each `beforeEach` re-seeds it with `[]` right
  // after `vi.resetAllMocks()`.
  listMyPendingJoinRequests: vi.fn(),
  approveJoinRequest: vi.fn(),
  rejectJoinRequest: vi.fn(),
}));

vi.mock("../api/inventories", () => ({
  getInventories: vi.fn(),
  getInventory: vi.fn(),
  getInventoryItems: vi.fn(),
  getInventoryItemBalance: vi.fn(),
  getMyInventoryItems: vi.fn(),
  getMyLentOutItems: vi.fn(),
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
  setItemListingPreference: vi.fn(),
}));

vi.mock("../api/products", () => ({
  createProduct: vi.fn(),
  getProductsPage: vi.fn(),
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
  createMyOrganization: vi.fn(),
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


function browseListing(
  overrides: Partial<BrowseTermItemListingResponse> = {},
): BrowseTermItemListingResponse {
  return {
    id: "501",
    term_id: "3",
    item_id: "9",
    lister_party_id: "7",
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

const mockProfile: peopleApi.UserProfileResponse = {
  id: "1",
  party_id: "1",
  account_user_id: "1",
  display_name: "Jan Kowalski",
  email: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  is_organizer: false,
  bio: null,
  avatar: null,
};

const mockOrganizerProfile: peopleApi.UserProfileResponse = {
  ...mockProfile,
  is_organizer: true,
};

const mockInventory: inventoriesApi.InventoryResponse = {
  id: "1",
  owner_user_id: "1",
  inventory_type: "PERSONAL",
  location: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

// Seeded category ids/names (migration 0025_category_reintroduction.py).
const mockCategories: categoriesApi.Category[] = [
  { id: "1", name: "Zabawka", description: null, sortOrder: 1, productCount: 0, createdAt: "", updatedAt: "" },
  { id: "2", name: "Książka", description: null, sortOrder: 2, productCount: 0, createdAt: "", updatedAt: "" },
  { id: "3", name: "Gra", description: null, sortOrder: 3, productCount: 0, createdAt: "", updatedAt: "" },
  { id: "4", name: "Ubranie", description: null, sortOrder: 4, productCount: 0, createdAt: "", updatedAt: "" },
  { id: "5", name: "Inne", description: null, sortOrder: 5, productCount: 0, createdAt: "", updatedAt: "" },
];

// Term/Group ids are UUID strings end to end (spec R29) — never coerced.
const GROUP_ID = "5f0c2a7e-3b1d-4e6a-9c8f-0000000000a5";
const OTHER_GROUP_ID = "6a1d3b8f-4c2e-4f7b-8d9a-0000000000a6";
const GROUP_PARTY_ID = "2b7e4c1a-9d3f-4a6b-8e5c-0000000000b2";
const TERM_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0000000000c1";
const LATER_TERM_ID = "7d8e9fa0-b1c2-4d3e-8f4a-0000000000c7";
const ATTENDEE_PARTY_ID = "a0b1c2d3-e4f5-4a6b-8c7d-0000000000d0";
const OTHER_ATTENDEE_PARTY_ID = "a1b2c3d4-e5f6-4a7b-8c8d-0000000000d1";
const ATTENDED_TERM_ID = "3e4f5a6b-7c8d-4e9f-8a0b-0000000000c3";
const OTHER_ATTENDED_TERM_ID = "8f9a0b1c-2d3e-4f4a-8b5c-0000000000c8";
const ENDED_TERM_ID = "9a0b1c2d-3e4f-4a5b-8c6d-0000000000c9";

const mockGroup: groupsApi.GroupResponse = {
  id: GROUP_ID,
  party_id: GROUP_PARTY_ID,
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
  id: "10",
  party_id: "99",
  name: "Kowalscy",
  child_count: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const mockAttendances: groupsApi.MyAttendanceResponse[] = [
  {
    attendance_id: "1",
    term_id: ATTENDED_TERM_ID,
    occurs_on: "2026-02-15",
    child_count: 2,
    group_id: GROUP_ID,
    group_name: "Nutki dla starszaków",
    organizer_display_name: "Ania Kowalska",
    organizer_slug: "ania-kowalska",
  },
  {
    attendance_id: "2",
    term_id: OTHER_ATTENDED_TERM_ID,
    occurs_on: "2026-03-01",
    child_count: 1,
    group_id: OTHER_GROUP_ID,
    group_name: "Rytmika",
    organizer_display_name: "Basia Nowak",
    organizer_slug: "basia-nowak",
  },
];

const mockGuardians: familiesApi.GuardianResponse[] = [
  {
    family_membership_id: "1",
    party_id: "1", // matches mockProfile.party_id — "(Ty)"
    user_profile_id: "1",
    display_name: "Jan Kowalski",
    email: null,
    is_primary_contact: true,
    valid_from: "2026-01-01",
    valid_to: null,
    role_type: "GUARDIAN",
    birth_year: null,
  },
  {
    family_membership_id: "2",
    party_id: "2",
    user_profile_id: "2",
    display_name: "Marek Kowalski",
    email: null,
    is_primary_contact: false,
    valid_from: "2026-01-01",
    valid_to: null,
    role_type: "GUARDIAN",
    birth_year: null,
  },
  {
    family_membership_id: "3",
    party_id: "3",
    user_profile_id: "3",
    display_name: "Zosia Kowalska",
    email: null,
    is_primary_contact: false,
    valid_from: "2026-01-01",
    valid_to: null,
    role_type: "CHILD",
    birth_year: 2018,
  },
];

function renderPanel(initialEntry = "/panel") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/panel" element={<PanelPage />} />
        <Route path="/panel/:view" element={<PanelPage />} />
      </Routes>
    </MemoryRouter>, { wrapper: createQueryWrapper() },
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
    </MemoryRouter>, { wrapper: createQueryWrapper() },
  );
}

function mockGuestDefaults() {
  vi.mocked(categoriesApi.getCategories).mockResolvedValue(mockCategories);
  vi.mocked(peopleApi.getMyProfile).mockResolvedValue(mockProfile);
  vi.mocked(peopleApi.getLeadershipsForPerson).mockResolvedValue([]);
  vi.mocked(inventoriesApi.getInventories).mockResolvedValue([mockInventory]);
  vi.mocked(inventoriesApi.getMyInventoryItems).mockResolvedValue([]);
  vi.mocked(inventoriesApi.getMyLentOutItems).mockResolvedValue([]);
  vi.mocked(inventoriesApi.getInventoryItemBalances).mockResolvedValue({});
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
    { id: "1", from_role_id: "1", to_group_id: GROUP_ID, organizer_party_id: "1", valid_from: "2026-01-01", valid_to: null },
  ]);
  vi.mocked(inventoriesApi.getInventories).mockResolvedValue([mockInventory]);
  vi.mocked(inventoriesApi.getMyInventoryItems).mockResolvedValue([]);
  vi.mocked(inventoriesApi.getMyLentOutItems).mockResolvedValue([]);
  vi.mocked(inventoriesApi.getInventoryItemBalances).mockResolvedValue({});
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
    vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([]);
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
      { id: TERM_ID, circle_group_id: GROUP_ID, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "", attendee_count: null, child_count: null },
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
      id: "1",
      party_id: "1",
      name: "Muzyczne Skrzaty",
      slug: "muzyczne-skrzaty",
      primary_color: null,
      accent_color: null,
      page_layout: "CLASSIC",
      palette_preset: null,
      created_at: "",
      updated_at: "",
    });
    renderPanel();
    await openMenu();

    const menu = screen.getByRole("menu");
    const link = within(menu).getByRole("menuitem", { name: /Moja organizacja/ });
    expect(link).toHaveAttribute("href", "/muzyczne-skrzaty?edit=1");
  });

  it("completing the GUEST 2-step flow calls createMyCircle then createTerm and flips isOrganizer to true after reload", async () => {
    mockGuestDefaults();
    // A brand-new guest circle has no Organization → the backend returns a
    // stable `k-<hash>` pseudo-slug so the done-screen CTA still deep-links
    // to the just-created term.
    vi.mocked(groupsApi.createMyCircle).mockResolvedValue(mockGroupHashSlug);
    vi.mocked(termsApi.createTerm).mockResolvedValue({
      id: TERM_ID, circle_group_id: GROUP_ID, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "",
      attendee_count: null, child_count: null,
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
      { id: "1", from_role_id: "1", to_group_id: GROUP_ID, organizer_party_id: "1", valid_from: "2026-01-01", valid_to: null },
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
      { id: TERM_ID, circle_group_id: GROUP_ID, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "", attendee_count: null, child_count: null },
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
      `/${mockGroupHashSlug.organizer_slug}/grupa/${mockGroupHashSlug.id}/term/${TERM_ID}`,
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

describe("PanelPage — item add entry point", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([]);
  });

  it('"+ Dodaj rzecz" links to the /product/new page instead of opening a modal', async () => {
    mockGuestDefaults();
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Moje rzeczy" }));
    const link = await screen.findByRole("link", { name: "+ Dodaj rzecz" });

    expect(link).toHaveAttribute("href", "/product/new");
    expect(screen.queryByRole("dialog", { name: "Dodaj rzecz" })).not.toBeInTheDocument();
  });
});

describe("PanelPage — dismissible home hints", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([]);
    localStorage.clear();
  });

  it("GUEST hint renders on Panel home and dismiss persists across a re-mount via localStorage", async () => {
    mockGuestDefaults();
    const { unmount } = renderPanel();

    expect(await screen.findByText("Dodaj swój pierwszy termin")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Zamknij: Dodaj swój pierwszy termin" }));
    expect(screen.queryByText("Dodaj swój pierwszy termin")).not.toBeInTheDocument();
    expect(localStorage.getItem("hint_first_term_dismissed:guest")).toBe("1");

    unmount();
    mockGuestDefaults();
    renderPanel();
    await screen.findByRole("heading", { name: /Cześć/ });
    expect(screen.queryByText("Dodaj swój pierwszy termin")).not.toBeInTheDocument();
  });

  it('GUEST "Możesz zostać organizatorem" opens a 3-step flow starting with the organization name, and dismisses on its own key', async () => {
    mockGuestDefaults();
    vi.mocked(organizationsApi.createMyOrganization).mockResolvedValue({
      id: "1", party_id: "1", name: "Studio Nutka", slug: "studio-nutka",
      primary_color: null, accent_color: null, page_layout: "CLASSIC", palette_preset: null,
      created_at: "", updated_at: "",
    });
    renderPanel();

    expect(await screen.findByText("Możesz zostać organizatorem")).toBeInTheDocument();

    // the second "Zacznijmy →" belongs to the become-organizer card
    fireEvent.click(screen.getAllByRole("button", { name: "Zacznijmy →" })[1]);
    const dialog = await screen.findByRole("dialog", { name: "Zostań organizatorem" });
    fireEvent.change(within(dialog).getByLabelText("Nazwa organizacji"), { target: { value: "Studio Nutka" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dalej →" }));

    await waitFor(() =>
      expect(organizationsApi.createMyOrganization).toHaveBeenCalledWith({ name: "Studio Nutka" }),
    );
    // step 2 is the circle name, step 3 the term
    expect(await within(dialog).findByPlaceholderText("np. Nutki dla starszaków")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Zamknij" }));

    fireEvent.click(screen.getByRole("button", { name: "Zamknij: Możesz zostać organizatorem" }));
    expect(screen.queryByText("Możesz zostać organizatorem")).not.toBeInTheDocument();
    expect(localStorage.getItem("hint_become_organizer_dismissed:guest")).toBe("1");
    // the other guest card is independent
    expect(screen.getByText("Dodaj swój pierwszy termin")).toBeInTheDocument();
  });

  it("a hint dismissed by another account in the same browser is still shown to this account", async () => {
    localStorage.setItem("hint_first_term_dismissed:someone-else", "1");
    localStorage.setItem("hint_become_organizer_dismissed:someone-else", "1");
    mockGuestDefaults();
    renderPanel();

    expect(await screen.findByText("Dodaj swój pierwszy termin")).toBeInTheDocument();
    expect(screen.getByText("Możesz zostać organizatorem")).toBeInTheDocument();
  });

  it("a GUEST who dismissed the pre-promotion first-term card still sees the organizer first-term card after getting a circle", async () => {
    localStorage.setItem("hint_first_term_dismissed:guest", "1");
    mockOrganizerDefaults(); // organizer-by-circle, zero terms
    renderPanel();

    expect(await screen.findByText("Ustal pierwsze spotkanie w swojej grupie.")).toBeInTheDocument();
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
    expect(localStorage.getItem("hint_org_polish_dismissed:guest")).toBe("1");
    expect(localStorage.getItem("hint_org_first_term_dismissed:guest")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Zamknij: Dodaj swój pierwszy termin" }));
    expect(screen.queryByText("Dodaj swój pierwszy termin")).not.toBeInTheDocument();
    expect(localStorage.getItem("hint_org_first_term_dismissed:guest")).toBe("1");
  });

  it("ORGANIZER first-term hint auto-hides once terms.length > 0, with no manual dismiss needed", async () => {
    mockOrganizerDefaults();
    vi.mocked(termsApi.getTerms).mockResolvedValue([
      { id: TERM_ID, circle_group_id: GROUP_ID, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "", attendee_count: null, child_count: null },
    ]);
    renderPanel();

    await screen.findByText("Dopracuj stronę organizacji");
    expect(screen.queryByText("Ustal pierwsze spotkanie w swojej grupie.")).not.toBeInTheDocument();
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
      id: "1",
      party_id: "1",
      name: "Muzyczne Skrzaty",
      slug: "muzyczne-skrzaty",
      primary_color: null,
      accent_color: null,
      page_layout: "CLASSIC",
      palette_preset: null,
      created_at: "",
      updated_at: "",
    });
    renderPanel();

    const link = await screen.findByRole("link", { name: "Przejdź →" });
    expect(link).toHaveAttribute("href", "/muzyczne-skrzaty?edit=1");
    expect(
      screen.getByText("Wybierz układ i kolory swojej strony — zobaczą je odwiedzający."),
    ).toBeInTheDocument();
  });

  // --- Group 11 gap review: cross-group composition (Group 6 stepper + Group 7 hint) ---

  it("GUEST hint auto-disappears after completing the real 2-step first-term stepper (isOrganizer flip, not a manual dismiss)", async () => {
    mockGuestDefaults();
    vi.mocked(groupsApi.createMyCircle).mockResolvedValue(mockGroup);
    vi.mocked(termsApi.createTerm).mockResolvedValue({
      id: TERM_ID, circle_group_id: GROUP_ID, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "",
      attendee_count: null, child_count: null,
    });
    renderPanel();

    expect(await screen.findByText("Dodaj swój pierwszy termin")).toBeInTheDocument();
    // two guest hints share the CTA label — the first is "Dodaj swój pierwszy termin"
    fireEvent.click(screen.getAllByRole("button", { name: "Zacznijmy →" })[0]);

    const dialog = await screen.findByRole("dialog", { name: "Dodaj pierwszy termin" });
    fireEvent.change(within(dialog).getByPlaceholderText("np. Nutki dla starszaków"), {
      target: { value: "Nutki" },
    });

    vi.mocked(peopleApi.getLeadershipsForPerson).mockResolvedValue([
      { id: "1", from_role_id: "1", to_group_id: GROUP_ID, organizer_party_id: "1", valid_from: "2026-01-01", valid_to: null },
    ]);
    vi.mocked(groupsApi.getGroup).mockResolvedValue(mockGroup);
    vi.mocked(groupsApi.getTermAttendeesForFormalization).mockResolvedValue([]);
    vi.mocked(termsApi.getTerms).mockResolvedValue([]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Dalej →" }));
    await waitFor(() => expect(groupsApi.createMyCircle).toHaveBeenCalled());

    const dateInput = await within(dialog).findByLabelText("Data i godzina");
    fireEvent.change(dateInput, { target: { value: "2026-02-01T17:00" } });

    vi.mocked(termsApi.getTerms).mockResolvedValue([
      { id: TERM_ID, circle_group_id: GROUP_ID, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "", attendee_count: null, child_count: null },
    ]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj" }));

    await waitFor(() => expect(termsApi.createTerm).toHaveBeenCalled());
    fireEvent.click(await within(dialog).findByRole("button", { name: "Gotowe" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // Hint disappears purely because `!isOrganizer` flips false — it was
    // never dismissed via its own "Zamknij" button in this test.
    await waitFor(() => expect(screen.queryByText("Dodaj swój pierwszy termin")).not.toBeInTheDocument());
    expect(localStorage.getItem("hint_first_term_dismissed:guest")).toBeNull();
  });

  it("ORGANIZER first-term hint auto-hides after a term is added via the real ORGANIZER 1-step stepper (not just terms mocked directly)", async () => {
    mockOrganizerDefaults();
    vi.mocked(termsApi.createTerm).mockResolvedValue({
      id: TERM_ID, circle_group_id: GROUP_ID, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "",
      attendee_count: null, child_count: null,
    });
    renderPanel();

    expect(await screen.findByText("Ustal pierwsze spotkanie w swojej grupie.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dodaj termin →" }));

    const dialog = await screen.findByRole("dialog", { name: "Dodaj pierwszy termin" });
    const dateInput = await within(dialog).findByLabelText("Data i godzina");
    fireEvent.change(dateInput, { target: { value: "2026-02-01T17:00" } });

    vi.mocked(termsApi.getTerms).mockResolvedValue([
      { id: TERM_ID, circle_group_id: GROUP_ID, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "", attendee_count: null, child_count: null },
    ]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj termin" }));

    await waitFor(() => expect(termsApi.createTerm).toHaveBeenCalled());
    fireEvent.click(await within(dialog).findByRole("button", { name: "Gotowe" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await waitFor(() =>
      expect(screen.queryByText("Ustal pierwsze spotkanie w swojej grupie.")).not.toBeInTheDocument(),
    );
    // org-polish hint is a separate, still-undismissed card — unaffected.
    expect(screen.getByText("Dopracuj stronę organizacji")).toBeInTheDocument();
  });
});

describe("PanelPage — Rodzina section", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([]);
  });

  it("/panel/rodzina renders the family list with role labels (Ty / opiekun / dziecko, no avatars)", async () => {
    mockGuestDefaults();
    vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([mockFamily]);
    vi.mocked(familiesApi.getGuardians).mockResolvedValue(mockGuardians);
    renderPanel("/panel/rodzina");

    expect(await screen.findByRole("heading", { name: "Mój dom", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("Jan Kowalski", { selector: "h3" })).toHaveTextContent("Jan Kowalski(Ty)");
    expect(screen.getByText("Marek Kowalski", { selector: "h3" })).toHaveTextContent("Marek Kowalski(opiekun)");
    // a CHILD is never labelled "(opiekun)"
    expect(screen.getByText("Zosia Kowalska", { selector: "h3" })).toHaveTextContent("Zosia Kowalska(dziecko)");
    expect(screen.getAllByText("(opiekun)")).toHaveLength(1);
    expect(screen.getByText(`rocznik 2018 · ${formatApproxAge(approxAge(2018))}`)).toBeInTheDocument();
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
    renderPanel("/panel/rodzina");
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
    renderPanel("/panel/rodzina");

    expect(await screen.findByRole("heading", { name: "Mój dom", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("Jan Kowalski", { selector: "h3" })).toBeInTheDocument();
    expect(screen.getByText("Marek Kowalski", { selector: "h3" })).toBeInTheDocument();
  });
});

describe("PanelPage — Mój dom — no family", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([]);
  });

  // The "Mój dom" entry lives in the header AccountMenu (outside PanelPage),
  // so these tests land on the section route directly.
  function openMojDom() {
    renderPanel("/panel/rodzina");
  }

  it("renders the no-family empty-state card with a CTA for a GUEST", async () => {
    mockGuestDefaults();
    openMojDom();

    expect(await screen.findByText("Nie masz jeszcze rodziny")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Załóż rodzinę" })).toBeInTheDocument();
  });

  it("renders the no-family empty-state card with a CTA for an ORGANIZER", async () => {
    mockOrganizerDefaults();
    openMojDom();

    expect(await screen.findByText("Nie masz jeszcze rodziny")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Załóż rodzinę" })).toBeInTheDocument();
  });

  it("the CTA opens CreateFamilyDialog", async () => {
    mockGuestDefaults();
    openMojDom();

    fireEvent.click(await screen.findByRole("button", { name: "Załóż rodzinę" }));

    const dialog = await screen.findByRole("dialog", { name: "Załóż rodzinę" });
    expect(within(dialog).getByLabelText("Nazwa rodziny")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Dalej" })).toBeInTheDocument();
  });

  it("step 1 submits the typed name to createOwnFamily and advances to step 2", async () => {
    mockGuestDefaults();
    vi.mocked(familiesApi.createOwnFamily).mockResolvedValue({ ...mockFamily, name: "Nowakowie" });
    openMojDom();
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
    openMojDom();
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
    openMojDom();
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
    openMojDom();
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
    openMojDom();
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
    vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([]);
  });

  async function openMojDom() {
    renderPanel("/panel/rodzina");
    await screen.findByRole("heading", { name: "Mój dom", level: 2 });
  }

  it("calls renameFamily and updates the heading in place", async () => {
    mockGuestDefaults();
    vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([mockFamily]);
    vi.mocked(familiesApi.getGuardians).mockResolvedValue(mockGuardians);
    vi.mocked(familiesApi.renameFamily).mockResolvedValue({ ...mockFamily, name: "Nowakowie" });
    await openMojDom();

    fireEvent.click(screen.getByRole("button", { name: "Zmień nazwę rodziny" }));
    const input = screen.getByLabelText("Nazwa rodziny");
    fireEvent.change(input, { target: { value: "Nowakowie" } });

    vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([{ ...mockFamily, name: "Nowakowie" }]);
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    await waitFor(() => expect(familiesApi.renameFamily).toHaveBeenCalledWith("10", "Nowakowie"));
    expect(await screen.findByText("Nowakowie", { selector: "h3" })).toBeInTheDocument();
  });

  it("network error shows an inline message and restores the previous name", async () => {
    mockGuestDefaults();
    vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([mockFamily]);
    vi.mocked(familiesApi.getGuardians).mockResolvedValue(mockGuardians);
    vi.mocked(familiesApi.renameFamily).mockRejectedValue(new Error("network"));
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
    vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([]);
  });

  async function openMojDom() {
    renderPanel("/panel/rodzina");
    await screen.findByRole("heading", { name: "Mój dom", level: 2 });
  }

  it("removes a family member and refreshes the list", async () => {
    mockGuestDefaults();
    vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([mockFamily]);
    vi.mocked(familiesApi.getGuardians)
      .mockResolvedValueOnce(mockGuardians)
      .mockResolvedValueOnce([mockGuardians[0]]);
    vi.mocked(familiesApi.removeFamilyMember).mockResolvedValue(undefined);
    await openMojDom();

    expect(screen.getByText("Marek Kowalski", { selector: "h3" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Usuń członka rodziny Marek Kowalski" }));

    await waitFor(() =>
      expect(familiesApi.removeFamilyMember).toHaveBeenCalledWith("10", "2"),
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
    await openMojDom();

    fireEvent.click(screen.getByRole("button", { name: "Usuń członka rodziny Marek Kowalski" }));

    expect(
      await screen.findByText("Nie można usunąć jedynego opiekuna rodziny"),
    ).toBeInTheDocument();
    expect(screen.getByText("Marek Kowalski", { selector: "h3" })).toBeInTheDocument();
  });
});

describe("PanelPage — Mój dom — birth year, return to term, errors", () => {
  const RETURN_PATH = "/x/grupa/1/term/2";

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([]);
  });

  async function openFamily(initialEntry = "/panel/rodzina") {
    mockGuestDefaults();
    vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([mockFamily]);
    vi.mocked(familiesApi.getGuardians).mockResolvedValue(mockGuardians);
    renderPanel(initialEntry);
    await screen.findByRole("heading", { name: "Mój dom", level: 2 });
  }

  it("birth-year field appears only for Dziecko and is sent only for CHILD", async () => {
    vi.mocked(familiesApi.createLightweightMembers).mockResolvedValue({ family: mockFamily, guardians: mockGuardians });
    await openFamily();

    expect(screen.queryByLabelText("Rok urodzenia")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dziecko" }));
    fireEvent.change(screen.getByLabelText("Rok urodzenia"), { target: { value: "2019" } });
    expect(screen.getByText(formatApproxAge(approxAge(2019)))).toBeInTheDocument();

    // switching to Opiekun hides and clears the year
    fireEvent.click(screen.getByRole("button", { name: "Opiekun" }));
    expect(screen.queryByLabelText("Rok urodzenia")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dziecko" }));
    expect(screen.getByLabelText("Rok urodzenia")).toHaveValue(null);

    // out-of-range year: inline error, submit disabled
    fireEvent.change(screen.getByPlaceholderText("np. Zosia Kowalska"), { target: { value: "Ola Kowalska" } });
    fireEvent.change(screen.getByLabelText("Rok urodzenia"), { target: { value: "1890" } });
    expect(screen.getByText(`Podaj rok urodzenia z zakresu 1900–${new Date().getFullYear()}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dodaj" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Rok urodzenia"), { target: { value: "2019" } });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj" }));

    await waitFor(() =>
      expect(familiesApi.createLightweightMembers).toHaveBeenCalledWith([
        { name: "Ola Kowalska", role_type: "CHILD", birth_year: 2019 },
      ]),
    );
  });

  it("inline birth-year edit saves and toasts", async () => {
    vi.mocked(familiesApi.updateChildBirthYear).mockResolvedValue(undefined);
    await openFamily();

    fireEvent.click(screen.getByRole("button", { name: "Edytuj rok urodzenia: Zosia Kowalska" }));
    const input = screen.getByLabelText("Rok urodzenia: Zosia Kowalska");
    expect(input).toHaveValue(2018);
    fireEvent.change(input, { target: { value: "2017" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(familiesApi.updateChildBirthYear).toHaveBeenCalledWith("10", "3", 2017));
    expect(await screen.findByText("Zapisano rok urodzenia")).toBeInTheDocument();
    expect(screen.queryByLabelText("Rok urodzenia: Zosia Kowalska")).not.toBeInTheDocument();
  });

  it("returnTo safe shows link; unsafe hides it", async () => {
    await openFamily(`/panel/rodzina?returnTo=${encodeURIComponent(RETURN_PATH)}`);
    expect(screen.getByRole("link", { name: "Wróć do terminu" })).toHaveAttribute("href", RETURN_PATH);
  });

  it("an unsafe returnTo (//evil.com) renders no return link", async () => {
    await openFamily(`/panel/rodzina?returnTo=${encodeURIComponent("//evil.com")}`);
    expect(screen.queryByRole("link", { name: "Wróć do terminu" })).not.toBeInTheDocument();
  });

  it("empty family state shows the return button", async () => {
    mockGuestDefaults();
    renderPanel(`/panel/rodzina?returnTo=${encodeURIComponent(RETURN_PATH)}`);

    expect(await screen.findByText("Nie masz jeszcze rodziny")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Wróć do terminu" })).toHaveAttribute("href", RETURN_PATH);
  });

  it("CreateFamilyDialog step 2 sends birth_year for a child draft", async () => {
    mockGuestDefaults();
    vi.mocked(familiesApi.createOwnFamily).mockResolvedValue(mockFamily);
    vi.mocked(familiesApi.createLightweightMembers).mockResolvedValue({ family: mockFamily, guardians: mockGuardians });
    renderPanel(`/panel/rodzina?returnTo=${encodeURIComponent(RETURN_PATH)}`);
    fireEvent.click(await screen.findByRole("button", { name: "Załóż rodzinę" }));

    const dialog = await screen.findByRole("dialog", { name: "Załóż rodzinę" });
    fireEvent.change(within(dialog).getByLabelText("Nazwa rodziny"), { target: { value: "Kowalscy" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dalej" }));
    await within(dialog).findByRole("button", { name: "Zakończ" });

    fireEvent.change(within(dialog).getByLabelText("Imię i nazwisko"), { target: { value: "Marek Kowalski" } });
    expect(within(dialog).queryByLabelText("Rok urodzenia")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj kolejną osobę" }));

    fireEvent.change(within(dialog).getByLabelText("Imię i nazwisko"), { target: { value: "Zosia Kowalska" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dziecko" }));
    fireEvent.change(within(dialog).getByLabelText("Rok urodzenia"), { target: { value: "2018" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj kolejną osobę" }));

    const rows = within(dialog).getAllByRole("listitem");
    expect(rows[1]).toHaveTextContent(`Dziecko · ${formatApproxAge(approxAge(2018))}`);
    // the year resets together with the role after a draft is added
    expect(within(dialog).queryByLabelText("Rok urodzenia")).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Zakończ" }));
    await waitFor(() =>
      expect(familiesApi.createLightweightMembers).toHaveBeenCalledWith([
        { name: "Marek Kowalski", role_type: "GUARDIAN" },
        { name: "Zosia Kowalska", role_type: "CHILD", birth_year: 2018 },
      ]),
    );
    // the dialog never navigates, so returnTo survives
    expect(screen.getByRole("link", { name: "Wróć do terminu" })).toHaveAttribute("href", RETURN_PATH);
  });

  it("add-member server error message shown verbatim", async () => {
    vi.mocked(familiesApi.createLightweightMembers).mockRejectedValue(
      new ApiError(400, "Bad Request", { message: "Rok urodzenia można ustawić tylko dziecku" }),
    );
    await openFamily();

    fireEvent.change(screen.getByPlaceholderText("np. Zosia Kowalska"), { target: { value: "Ola Kowalska" } });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj" }));

    expect(await screen.findByText("Rok urodzenia można ustawić tylko dziecku")).toBeInTheDocument();
  });
});

describe("PanelPage — term edit dialog", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([]);
  });

  const term = {
    id: TERM_ID,
    circle_group_id: GROUP_ID,
    occurs_on: "2026-02-01",
    description: "Pierwsze zajęcia",
    created_at: "",
    updated_at: "",
    attendee_count: null,
    child_count: null,
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
      expect(termsApi.updateTerm).toHaveBeenCalledWith(TERM_ID, { occurs_on: "2026-03-09T18:00" }),
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
      party_id: ATTENDEE_PARTY_ID,
      display_name: "Zosia Nowak",
      child_count: 0,
      family_id: "f0e1d2c3-b4a5-4968-8776-0000000000e0",
      family_name: "Nowakowie",
      children: [],
      already_member: false,
    },
    {
      party_id: OTHER_ATTENDEE_PARTY_ID,
      display_name: "Tomek Wiśniewski",
      child_count: 0,
      family_id: null,
      family_name: null,
      children: [],
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
      expect(groupsApi.formalizeGroupFromTerm).toHaveBeenCalledWith(GROUP_ID, TERM_ID, [ATTENDEE_PARTY_ID]),
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
    // error/retry path on this surface was never exercised at the /panel
    // surface.
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

describe("PanelPage — Term/Group ids stay UUID strings (R29)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([]);
  });

  const term: termsApi.TermResponse = {
    id: TERM_ID,
    circle_group_id: GROUP_ID,
    occurs_on: "2026-02-01",
    description: null,
    created_at: "",
    updated_at: "",
    attendee_count: null,
    child_count: null,
  };

  it('"Nowy termin" group select keeps the selected group\'s UUID', async () => {
    mockOrganizerDefaults();
    const otherGroup: groupsApi.GroupResponse = { ...mockGroup, id: OTHER_GROUP_ID, name: "Rytmika" };
    vi.mocked(peopleApi.getLeadershipsForPerson).mockResolvedValue([
      { id: "1", from_role_id: "1", to_group_id: GROUP_ID, organizer_party_id: "1", valid_from: "2026-01-01", valid_to: null },
      { id: "2", from_role_id: "1", to_group_id: OTHER_GROUP_ID, organizer_party_id: "1", valid_from: "2026-01-01", valid_to: null },
    ]);
    vi.mocked(groupsApi.getGroup).mockImplementation(async (id) => (id === OTHER_GROUP_ID ? otherGroup : mockGroup));
    vi.mocked(termsApi.createTerm).mockResolvedValue({ ...term, circle_group_id: OTHER_GROUP_ID });
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Spotkania" }));
    fireEvent.click(await screen.findByRole("button", { name: "+ Dodaj termin" }));
    const dialog = await screen.findByRole("dialog", { name: "Dodaj termin zajęć" });

    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: OTHER_GROUP_ID } });
    // This modal's `Field` label isn't associated with its input.
    const dateInput = dialog.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
    fireEvent.change(dateInput, { target: { value: "2026-02-01T17:00" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj termin" }));

    await waitFor(() =>
      expect(termsApi.createTerm).toHaveBeenCalledWith({
        circle_group_id: OTHER_GROUP_ID,
        occurs_on: "2026-02-01T17:00",
        description: undefined,
      }),
    );
  });

  it("formalize picker sends string party ids", async () => {
    mockOrganizerDefaults();
    vi.mocked(termsApi.getTerms).mockResolvedValue([term]);
    vi.mocked(groupsApi.getTermAttendeesForFormalization).mockResolvedValue([
      {
        party_id: ATTENDEE_PARTY_ID,
        display_name: "Zosia Nowak",
        child_count: 1,
        family_id: "f0e1d2c3-b4a5-4968-8776-0000000000e0",
        family_name: "Nowakowie",
        children: [],
        already_member: false,
      },
    ]);
    vi.mocked(groupsApi.formalizeGroupFromTerm).mockResolvedValue(mockGroup);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Spotkania" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Edytuj termin" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Edytuj termin" });
    await within(dialog).findByLabelText("Ustal Zosia Nowak jako stałego członka");
    fireEvent.click(within(dialog).getByRole("button", { name: "Ustal stałych członków" }));

    await waitFor(() =>
      expect(groupsApi.formalizeGroupFromTerm).toHaveBeenCalledWith(GROUP_ID, TERM_ID, [ATTENDEE_PARTY_ID]),
    );
    expect(groupsApi.getTermAttendeesForFormalization).toHaveBeenCalledWith(GROUP_ID, TERM_ID);
  });

  it("getTerms is called with the group's UUID string", async () => {
    mockOrganizerDefaults();
    renderPanel();

    await waitFor(() => expect(termsApi.getTerms).toHaveBeenCalledWith(GROUP_ID));
    expect(groupsApi.getGroup).toHaveBeenCalledWith(GROUP_ID);
  });
});

describe("PanelPage — edit group dialog (name/location/spots/layout, replaces old inline rename + layout pills)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([]);
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
      expect(groupsApi.updateGroupLayoutMode).toHaveBeenCalledWith(GROUP_ID, "Nutki", "PITCH", "PUBLIC"),
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
    vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([]);
  });

  it("renders one tile per attendance with a public-term link (GUEST)", async () => {
    mockGuestDefaults();
    vi.mocked(groupsApi.getMyAttendances).mockResolvedValue(mockAttendances);
    renderPanel();

    await screen.findByRole("heading", { name: "Zapisane zajęcia" });
    const first = await screen.findByRole("link", { name: /Nutki dla starszaków/ });
    expect(first).toHaveAttribute("href", `/ania-kowalska/grupa/${GROUP_ID}/term/${ATTENDED_TERM_ID}`);
    expect(first).toHaveTextContent("Ania Kowalska");
    const second = screen.getByRole("link", { name: /Rytmika/ });
    expect(second).toHaveAttribute("href", `/basia-nowak/grupa/${OTHER_GROUP_ID}/term/${OTHER_ATTENDED_TERM_ID}`);
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
    vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([]);
  });

  it("each term row in the Spotkania list is a link (the whole tile) to the per-term public page, not the authenticated one", async () => {
    mockOrganizerDefaults();
    vi.mocked(termsApi.getTerms).mockResolvedValue([
      { id: TERM_ID, circle_group_id: GROUP_ID, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "", attendee_count: null, child_count: null },
    ]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Spotkania" }));

    const link = await screen.findByRole("link", { name: new RegExp(mockGroup.name) });
    expect(link).toHaveAttribute("href", `/${mockGroup.organizer_slug}/grupa/${mockGroup.id}/term/${TERM_ID}`);
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
    expect(first).toHaveAttribute("href", `/ania-kowalska/grupa/${GROUP_ID}/term/${ATTENDED_TERM_ID}`);
    const second = screen.getByRole("link", { name: /Rytmika/ });
    expect(second).toHaveAttribute("href", `/basia-nowak/grupa/${OTHER_GROUP_ID}/term/${OTHER_ATTENDED_TERM_ID}`);
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

describe("PanelPage — organizer term card signup chip", () => {
  const chipName = /^Zapisani na termin:/;

  function mockOrganizerTerm(attendeeCount: number | null, childCount: number | null) {
    mockOrganizerDefaults();
    vi.mocked(termsApi.getTerms).mockResolvedValue([
      {
        id: TERM_ID, circle_group_id: GROUP_ID, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "",
        attendee_count: attendeeCount, child_count: childCount,
      },
    ]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
  }

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([]);
  });

  it("organizer card shows signup chip linking to attendees page", async () => {
    mockOrganizerTerm(5, 8);
    renderPanel();

    // Home (first three terms) renders the shared organizer card…
    const homeChip = await screen.findByRole("link", { name: chipName });
    expect(homeChip).toHaveTextContent("5 zapisów · 8 dzieci");
    expect(homeChip).toHaveAccessibleName("Zapisani na termin: 5 zapisów, 8 dzieci");
    expect(homeChip).toHaveAttribute("href", `/panel/terminy/${TERM_ID}`);

    // …and so does Spotkania.
    fireEvent.click(await screen.findByRole("button", { name: "Spotkania" }));
    const listChip = await screen.findByRole("link", { name: chipName });
    expect(listChip).toHaveAttribute("href", `/panel/terminy/${TERM_ID}`);
  });

  it("organizer card chip uses Polish plural forms (2 zapisy · 1 dziecko)", async () => {
    mockOrganizerTerm(2, 1);
    renderPanel();

    const chip = await screen.findByRole("link", { name: chipName });
    expect(chip).toHaveTextContent("2 zapisy · 1 dziecko");
  });

  it('organizer card shows "Brak zapisów" for zero attendees', async () => {
    mockOrganizerTerm(0, 0);
    renderPanel();

    const chip = await screen.findByRole("link", { name: chipName });
    expect(chip).toHaveTextContent("Brak zapisów");
    expect(chip).not.toHaveTextContent("dzieci");
    expect(chip).toHaveAttribute("href", `/panel/terminy/${TERM_ID}`);
  });

  it("no chip when counts are null", async () => {
    mockOrganizerTerm(null, null);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Spotkania" }));
    await screen.findByRole("link", { name: new RegExp(mockGroup.name) });
    expect(screen.queryByRole("link", { name: chipName })).not.toBeInTheDocument();
    expect(screen.queryByText("Brak zapisów")).not.toBeInTheDocument();
  });
});

describe("PanelPage — per-term public links & copy-link button", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([]);
  });

  it("organizer with no Organization — 'Terminy' row still links to the per-term public page via the hash slug", async () => {
    mockOrganizerDefaults();
    vi.mocked(groupsApi.getGroup).mockResolvedValue(mockGroupHashSlug);
    vi.mocked(groupsApi.getTermAttendeesForFormalization).mockResolvedValue([]);
    vi.mocked(termsApi.getTerms).mockResolvedValue([
      { id: TERM_ID, circle_group_id: GROUP_ID, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "", attendee_count: null, child_count: null },
    ]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Spotkania" }));

    const link = await screen.findByRole("link", { name: new RegExp(mockGroup.name) });
    expect(link).toHaveAttribute("href", `/${mockGroupHashSlug.organizer_slug}/grupa/${mockGroup.id}/term/${TERM_ID}`);
  });

  it("organizer term tile marks a claimed needed item with a checkmark", async () => {
    mockOrganizerDefaults();
    vi.mocked(termsApi.getTerms).mockResolvedValue([
      { id: TERM_ID, circle_group_id: GROUP_ID, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "", attendee_count: null, child_count: null },
    ]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([
      {
        id: "1", term_id: TERM_ID, product_id: "5", product_name: "Bębenek",
        product_category_id: "5", product_category_name: "Inne", description: null, claimed: true, created_at: "", updated_at: "",
      },
      {
        id: "2", term_id: TERM_ID, product_id: "6", product_name: "Koc",
        product_category_id: "5", product_category_name: "Inne", description: null, claimed: false, created_at: "", updated_at: "",
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
      { id: TERM_ID, circle_group_id: GROUP_ID, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "", attendee_count: null, child_count: null },
    ]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Spotkania" }));

    const copyBtn = await screen.findByRole("button", { name: "Kopiuj link do terminu" });
    expect(copyBtn).not.toBeDisabled();
    fireEvent.click(copyBtn);

    expect(clipboardWriteText).toHaveBeenCalledWith(
      `${window.location.origin}/${mockGroup.organizer_slug}/grupa/${mockGroup.id}/term/${TERM_ID}`,
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
      id: LATER_TERM_ID, circle_group_id: GROUP_ID, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "",
      attendee_count: null, child_count: null,
    });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Dodaj termin →" }));

    const dialog = await screen.findByRole("dialog", { name: "Dodaj pierwszy termin" });
    fireEvent.change(await within(dialog).findByLabelText("Data i godzina"), { target: { value: "2026-02-01T17:00" } });

    vi.mocked(termsApi.getTerms).mockResolvedValue([
      { id: LATER_TERM_ID, circle_group_id: GROUP_ID, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "", attendee_count: null, child_count: null },
    ]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj termin" }));

    const publicLink = await within(dialog).findByRole("link", { name: /Przejdź do publicznej strony/ });
    expect(publicLink).toHaveAttribute("href", `/${mockGroup.organizer_slug}/grupa/${GROUP_ID}/term/${LATER_TERM_ID}`);
  });
});

describe("PanelPage — needed item sub-CRUD (in the term dialog)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([]);
  });

  const term = {
    id: TERM_ID,
    circle_group_id: GROUP_ID,
    occurs_on: "2026-02-01",
    description: "Zajęcia",
    created_at: "",
    updated_at: "",
    attendee_count: null,
    child_count: null,
  };
  const neededItem = {
    id: "11",
    term_id: TERM_ID,
    product_id: "5",
    product_name: "Bębenek",
    product_category_id: "5",
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
      id: "42", name: "Mata", description: null, photo_url: null, sku: "MATA-1",
      category_id: "1", plugin_data: null, created_at: "", updated_at: "",
    });
    vi.mocked(termsApi.createNeededItem).mockResolvedValue({
      id: "12", term_id: TERM_ID, product_id: "42", product_name: "Mata", product_category_id: "1", product_category_name: "Zabawka",
      description: "Koc", claimed: false, created_at: "", updated_at: "",
    });
    const dialog = await openEditDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj potrzebną rzecz" }));
    fireEvent.change(within(dialog).getByLabelText("Nazwa nowej rzeczy"), { target: { value: "Mata" } });
    fireEvent.change(within(dialog).getByLabelText("Doprecyzowanie nowej rzeczy"), { target: { value: "Koc" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj" }));

    await waitFor(() =>
      expect(productsApi.resolveProduct).toHaveBeenCalledWith({ name: "Mata", category_id: "1" }),
    );
    await waitFor(() =>
      expect(termsApi.createNeededItem).toHaveBeenCalledWith({
        term_id: TERM_ID, product_id: "42", description: "Koc",
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
      expect(termsApi.updateNeededItem).toHaveBeenCalledWith("11", { description: "duży" }),
    );
    expect(productsApi.resolveProduct).not.toHaveBeenCalled();
  });

  it("deletes a needed item via the dialog (await-then-refresh)", async () => {
    mockTermWithNeeded();
    vi.mocked(termsApi.deleteNeededItem).mockResolvedValue(undefined);
    const dialog = await openEditDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "Usuń potrzebną rzecz" }));

    await waitFor(() => expect(termsApi.deleteNeededItem).toHaveBeenCalledWith("11"));
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
    vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([]);
  });

  const invItem = {
    id: "21",
    inventory_id: "1",
    home_inventory_id: null,
    product_id: "7",
    product_name: "Rowerek",
    condition: "GOOD" as const,
    added_at: "",
    created_at: "",
    updated_at: "",
    listing_mode: null,
    photos_moderation_pending: false,
  };

  function mockItems() {
    mockGuestDefaults();
    vi.mocked(inventoriesApi.getMyInventoryItems).mockResolvedValue([invItem]);
  }

  it("seeds each item's mode toggle from its listing_mode in 'Moje rzeczy'", async () => {
    mockGuestDefaults();
    vi.mocked(inventoriesApi.getMyInventoryItems).mockResolvedValue([
      { ...invItem, listing_mode: "GIFT" },
    ]);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Moje rzeczy" }));

    expect(await screen.findByRole("button", { name: "Oddam" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Wypożyczę" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
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

  it("shows a lent-out item under 'Wypożyczone innym', not in 'Moje rzeczy'", async () => {
    mockGuestDefaults();
    vi.mocked(inventoriesApi.getMyLentOutItems).mockResolvedValue([
      {
        id: "22",
        product_id: "7",
        product_name: "Rowerek",
        condition: "GOOD",
        lent_to_display_name: "Marek",
        lent_due_date: "2026-10-15T00:00:00Z",
      },
    ]);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Moje rzeczy" }));
    expect(await screen.findByText("Nie masz jeszcze żadnej rzeczy.")).toBeInTheDocument();
    expect(screen.queryByText("Rowerek")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Wypożyczone" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Wypożyczone innym" }));
    expect(within(screen.getByRole("tabpanel")).getByText("Rowerek")).toBeInTheDocument();
  });
});

describe("PanelPage — mode toggle errors and photo-moderation poll", () => {
  const MODERATION_409 =
    "Nie można wystawić tej rzeczy — jej zdjęcia czekają na moderację. Tryb wypożyczę/oddam/zamienię włączysz po ich zatwierdzeniu.";

  const modItem = {
    id: "70",
    inventory_id: "1",
    home_inventory_id: null,
    product_id: "11",
    product_name: "Namiot",
    condition: "GOOD" as const,
    added_at: "",
    created_at: "",
    updated_at: "",
    listing_mode: null,
    photos_moderation_pending: false,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([]);
    vi.mocked(inventoriesApi.getInventoryItemBalance).mockResolvedValue({
      id: "1",
      item_id: modItem.id,
      status: "AVAILABLE",
      reserved_at: null,
      lent_at: null,
      returned_at: null,
      due_date: null,
      reservation_id: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    // Drop the per-test `visibilityState` override (falls back to jsdom's).
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("409 on setItemMode → toast shows server message verbatim and getMyInventoryItems re-fetched", async () => {
    mockGuestDefaults();
    vi.mocked(inventoriesApi.getMyInventoryItems).mockResolvedValue([modItem]);
    vi.mocked(itemListingPreferencesApi.setItemListingPreference).mockRejectedValue(
      new ApiError(409, "Conflict", { message: MODERATION_409 }),
    );
    renderPanel("/panel/rzeczy");

    fireEvent.click(await screen.findByRole("button", { name: "Oddam" }));

    expect(await screen.findByRole("status")).toHaveTextContent(MODERATION_409);
    await waitFor(() => expect(inventoriesApi.getMyInventoryItems).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "Oddam" })).toHaveAttribute("aria-pressed", "false");
  });

  it("network error → fallback toast text", async () => {
    mockGuestDefaults();
    vi.mocked(inventoriesApi.getMyInventoryItems).mockResolvedValue([modItem]);
    vi.mocked(itemListingPreferencesApi.setItemListingPreference).mockRejectedValue(
      new TypeError("Failed to fetch"),
    );
    renderPanel("/panel/rzeczy");

    fireEvent.click(await screen.findByRole("button", { name: "Oddam" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Nie udało się zapisać trybu — spróbuj ponownie",
    );
  });

  it("toast timeout scales with the message: the long 409 text outlives the 2.2 s default, then hides", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGuestDefaults();
    vi.mocked(inventoriesApi.getMyInventoryItems).mockResolvedValue([modItem]);
    vi.mocked(itemListingPreferencesApi.setItemListingPreference).mockRejectedValue(
      new ApiError(409, "Conflict", { message: MODERATION_409 }),
    );
    renderPanel("/panel/rzeczy");

    fireEvent.click(await screen.findByRole("button", { name: "Oddam" }));
    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent(MODERATION_409);
    // Long text gets the multi-line box, not the one-line pill.
    expect(toast).toHaveClass("rounded-2xl");

    // Math.max(2200, length * 45) ≈ 5.7 s for this message.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(screen.getByRole("status")).toHaveTextContent(MODERATION_409);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });
    expect(screen.queryByText(MODERATION_409)).not.toBeInTheDocument();
  });

  it("poll: getMyInventoryItems called every 10 s while pending and stops once the flag clears", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGuestDefaults();
    vi.mocked(inventoriesApi.getMyInventoryItems)
      .mockResolvedValueOnce([{ ...modItem, photos_moderation_pending: true }])
      .mockResolvedValueOnce([{ ...modItem, photos_moderation_pending: true }])
      .mockResolvedValue([modItem]);
    renderPanel("/panel/rzeczy");

    expect(await screen.findByText("Zdjęcia w moderacji")).toBeInTheDocument();
    expect(inventoriesApi.getMyInventoryItems).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(inventoriesApi.getMyInventoryItems).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(inventoriesApi.getMyInventoryItems).toHaveBeenCalledTimes(3);
    await waitFor(() => expect(screen.queryByText("Zdjęcia w moderacji")).not.toBeInTheDocument());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(inventoriesApi.getMyInventoryItems).toHaveBeenCalledTimes(3);
  });

  it("poll: not running while document is hidden", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let visibility: DocumentVisibilityState = "hidden";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    mockGuestDefaults();
    vi.mocked(inventoriesApi.getMyInventoryItems).mockResolvedValue([
      { ...modItem, photos_moderation_pending: true },
    ]);
    renderPanel("/panel/rzeczy");

    expect(await screen.findByText("Zdjęcia w moderacji")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(inventoriesApi.getMyInventoryItems).toHaveBeenCalledTimes(1);

    // Back to visible: the poll re-arms on `visibilitychange`.
    visibility = "visible";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(inventoriesApi.getMyInventoryItems).toHaveBeenCalledTimes(2);
  });

  it("poll: a stale poll response landing after a successful mode save does not flip the toggle back", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGuestDefaults();
    // A second item with photos in moderation keeps the poll running; the
    // first one (no mode yet) is the one toggled.
    const pendingItem = {
      ...modItem,
      id: "71",
      product_id: "12",
      product_name: "Śpiwór",
      photos_moderation_pending: true,
    };
    let resolvePoll: (value: (typeof modItem)[]) => void = () => {};
    vi.mocked(inventoriesApi.getMyInventoryItems)
      .mockResolvedValueOnce([modItem, pendingItem])
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePoll = resolve;
          }),
      )
      .mockResolvedValue([{ ...modItem, listing_mode: "GIFT" }, pendingItem]);
    vi.mocked(itemListingPreferencesApi.setItemListingPreference).mockResolvedValue(null);
    renderPanel("/panel/rzeczy");

    const oddam = (await screen.findAllByRole("button", { name: "Oddam" }))[0];
    expect(oddam).toHaveAttribute("aria-pressed", "false");

    // The poll GET starts (still unresolved) before the mode is saved.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(inventoriesApi.getMyInventoryItems).toHaveBeenCalledTimes(2);

    fireEvent.click(oddam);
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Oddam" })[0]).toHaveAttribute("aria-pressed", "true"),
    );

    // The poll response carries the pre-save mode (none) and lands late.
    await act(async () => {
      resolvePoll([modItem, pendingItem]);
      await Promise.resolve();
    });
    expect(screen.getAllByRole("button", { name: "Oddam" })[0]).toHaveAttribute("aria-pressed", "true");
  });
});

describe("PanelPage — Wypożyczone: 'Oddaję'", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([]);
  });

  it("sends a RETURN reservation with only item_id and reservation_type — no reserved_by_user_id", async () => {
    mockGuestDefaults();
    vi.mocked(inventoriesApi.getInventories).mockResolvedValue([
      mockInventory,
      { ...mockInventory, id: "2", inventory_type: "VIRTUAL" },
    ]);
    vi.mocked(inventoriesApi.getInventoryItems).mockResolvedValue([
      {
        id: "40",
        inventory_id: "2",
        home_inventory_id: "50",
        product_id: "8",
        product_name: "Wiertarka",
        condition: "GOOD",
        added_at: "",
        created_at: "",
        updated_at: "",
      },
    ]);
    vi.mocked(inventoriesApi.getInventoryItemBalance).mockResolvedValue({
      id: "1",
      item_id: "40",
      status: "LENT",
      reserved_at: null,
      lent_at: null,
      returned_at: null,
      due_date: null,
      reservation_id: null,
    });
    vi.mocked(inventoriesApi.getInventory).mockResolvedValue({ ...mockInventory, id: "50", owner_user_id: "7" });
    vi.mocked(peopleApi.getProfileByAccountUserId).mockResolvedValue({
      ...mockProfile,
      id: "7",
      account_user_id: "7",
      display_name: "Ola",
    });
    const reservation = {
      id: "300",
      item_id: "40",
      reservation_type: "RETURN" as const,
      reserved_by_user_id: "7",
      paired_reservation_id: null,
      reserved_at: "",
      expires_at: null,
      status: "PENDING" as const,
      notes: null,
    };
    vi.mocked(reservationsApi.createReservation).mockResolvedValue(reservation);
    vi.mocked(reservationsApi.confirmReservation).mockResolvedValue({ ...reservation, status: "CONFIRMED" });
    vi.mocked(reservationsApi.fulfillReservation).mockResolvedValue({ ...reservation, status: "FULFILLED" });
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Wypożyczone" }));
    fireEvent.click(await screen.findByRole("button", { name: "Oddaję Wiertarka" }));

    await waitFor(() =>
      expect(reservationsApi.createReservation).toHaveBeenCalledWith({
        item_id: "40",
        reservation_type: "RETURN",
      }),
    );
    await waitFor(() => expect(reservationsApi.fulfillReservation).toHaveBeenCalledWith("300"));
    expect(reservationsApi.confirmReservation).toHaveBeenCalledWith("300");
    expect(reservationsApi.getReservation).not.toHaveBeenCalled();
  });

  it("retrying after a failed fulfill finishes the existing RETURN instead of creating a new one", async () => {
    mockGuestDefaults();
    vi.mocked(inventoriesApi.getInventories).mockResolvedValue([
      mockInventory,
      { ...mockInventory, id: "2", inventory_type: "VIRTUAL" },
    ]);
    vi.mocked(inventoriesApi.getInventoryItems).mockResolvedValue([
      {
        id: "40",
        inventory_id: "2",
        home_inventory_id: "50",
        product_id: "8",
        product_name: "Wiertarka",
        condition: "GOOD",
        added_at: "",
        created_at: "",
        updated_at: "",
      },
    ]);
    // Server-side state the mocks share: the RETURN locks the balance until fulfilled.
    let balance: { status: "LENT" | "IN_TRANSIT"; reservation_id: string | null } = {
      status: "LENT",
      reservation_id: null,
    };
    vi.mocked(inventoriesApi.getInventoryItemBalance).mockImplementation(async () => ({
      id: "1",
      item_id: "40",
      reserved_at: null,
      lent_at: null,
      returned_at: null,
      due_date: null,
      ...balance,
    }));
    vi.mocked(inventoriesApi.getInventory).mockResolvedValue({ ...mockInventory, id: "50", owner_user_id: "7" });
    vi.mocked(peopleApi.getProfileByAccountUserId).mockResolvedValue({
      ...mockProfile,
      id: "7",
      account_user_id: "7",
      display_name: "Ola",
    });
    const reservation = {
      id: "300",
      item_id: "40",
      reservation_type: "RETURN" as const,
      reserved_by_user_id: "7",
      paired_reservation_id: null,
      reserved_at: "",
      expires_at: null,
      status: "PENDING" as const,
      notes: null,
    };
    vi.mocked(reservationsApi.createReservation).mockImplementation(async () => {
      balance = { status: "IN_TRANSIT", reservation_id: "300" };
      return reservation;
    });
    vi.mocked(reservationsApi.confirmReservation).mockResolvedValue({ ...reservation, status: "CONFIRMED" });
    vi.mocked(reservationsApi.getReservation).mockResolvedValue({ ...reservation, status: "CONFIRMED" });
    vi.mocked(reservationsApi.fulfillReservation)
      .mockRejectedValueOnce(new Error("500"))
      .mockResolvedValueOnce({ ...reservation, status: "FULFILLED" });
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Wypożyczone" }));
    fireEvent.click(await screen.findByRole("button", { name: "Oddaję Wiertarka" }));
    await waitFor(() => expect(reservationsApi.fulfillReservation).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Oddaję Wiertarka" }));

    await waitFor(() => expect(reservationsApi.fulfillReservation).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Oddaję Wiertarka" })).not.toBeInTheDocument(),
    );
    expect(reservationsApi.createReservation).toHaveBeenCalledTimes(1);
    expect(reservationsApi.confirmReservation).toHaveBeenCalledTimes(1);
    expect(reservationsApi.getReservation).toHaveBeenCalledWith("300");
    expect(reservationsApi.fulfillReservation).toHaveBeenLastCalledWith("300");
  });
});
describe("PanelPage — Wypożyczone: tabs", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([]);
  });

  const ownItem = {
    id: "60",
    inventory_id: "1",
    home_inventory_id: null,
    product_id: "9",
    product_name: "Hulajnoga",
    condition: "GOOD" as const,
    added_at: "",
    created_at: "",
    updated_at: "",
    listing_mode: null,
    photos_moderation_pending: false,
  };
  const lentOutItem = {
    id: "61",
    product_id: "9",
    product_name: "Rowerek",
    condition: "GOOD" as const,
    lent_to_display_name: "Marek",
    lent_due_date: "2026-10-15T00:00:00Z",
  };

  it("'Wypożyczone innym' lists the lent-out items with borrower and due date", async () => {
    mockGuestDefaults();
    vi.mocked(inventoriesApi.getMyInventoryItems).mockResolvedValue([ownItem]);
    vi.mocked(inventoriesApi.getMyLentOutItems).mockResolvedValue([lentOutItem]);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Wypożyczone" }));
    expect(await screen.findByRole("tab", { name: "Wypożyczone od innych" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Nie masz teraz nic pożyczonego.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Wypożyczone innym" }));

    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("Rowerek")).toBeInTheDocument();
    expect(within(panel).getByText("U: Marek")).toBeInTheDocument();
    expect(within(panel).getByText("Zwrot do: 15.10.2026")).toBeInTheDocument();
    expect(within(panel).queryByText("Hulajnoga")).not.toBeInTheDocument();
  });

  it("shows a 'Zobacz rzecz' link to /product/:itemId on both tabs", async () => {
    mockGuestDefaults();
    vi.mocked(inventoriesApi.getInventories).mockResolvedValue([
      mockInventory,
      { ...mockInventory, id: "2", inventory_type: "VIRTUAL" },
    ]);
    vi.mocked(inventoriesApi.getInventoryItems).mockResolvedValue([
      {
        id: "40",
        inventory_id: "2",
        home_inventory_id: "50",
        product_id: "8",
        product_name: "Wiertarka",
        condition: "GOOD",
        added_at: "",
        created_at: "",
        updated_at: "",
      },
    ]);
    vi.mocked(inventoriesApi.getInventoryItemBalance).mockResolvedValue({
      id: "1",
      item_id: "40",
      status: "LENT",
      reserved_at: null,
      lent_at: null,
      returned_at: null,
      due_date: null,
      reservation_id: null,
    });
    vi.mocked(inventoriesApi.getInventory).mockResolvedValue({ ...mockInventory, id: "50", owner_user_id: "7" });
    vi.mocked(peopleApi.getProfileByAccountUserId).mockResolvedValue({
      ...mockProfile,
      id: "7",
      account_user_id: "7",
      display_name: "Ola",
    });
    vi.mocked(inventoriesApi.getMyLentOutItems).mockResolvedValue([lentOutItem]);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Wypożyczone" }));
    expect(await screen.findByRole("link", { name: "Zobacz rzecz Wiertarka" })).toHaveAttribute(
      "href",
      "/product/40",
    );

    fireEvent.click(screen.getByRole("tab", { name: "Wypożyczone innym" }));
    expect(
      within(screen.getByRole("tabpanel")).getByRole("link", { name: "Zobacz rzecz Rowerek" }),
    ).toHaveAttribute("href", "/product/61");
  });

  it("'Wypożyczone innym' shows an empty state when nothing is lent out", async () => {
    mockGuestDefaults();
    vi.mocked(inventoriesApi.getMyInventoryItems).mockResolvedValue([ownItem]);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Wypożyczone" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Wypożyczone innym" }));

    expect(screen.getByText("Nikt nie ma teraz twoich rzeczy.")).toBeInTheDocument();
  });
});

describe("PanelPage — needed item edit error path", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([]);
  });

  const term = {
    id: TERM_ID,
    circle_group_id: GROUP_ID,
    occurs_on: "2026-02-01",
    description: "Zajęcia",
    created_at: "",
    updated_at: "",
    attendee_count: null,
    child_count: null,
  };
  const neededItem = {
    id: "11",
    term_id: TERM_ID,
    product_id: "5",
    product_name: "Bębenek",
    product_category_id: "5",
    product_category_name: "Inne",
    description: "mały",
    claimed: false,
    created_at: "",
    updated_at: "",
  };

  it("shows an inline error and keeps the row editor open with the typed values when the edit is rejected", async () => {
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

    // A non-problem error falls back to the generic message, shown as an alert.
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent(/Nie udało się zapisać zmiany/);
    // The editor stays open and keeps what the user typed, so they can retry.
    expect(within(dialog).getByLabelText("Nazwa rzeczy")).toHaveValue("Bębenek");
    expect(within(dialog).getByLabelText("Doprecyzowanie rzeczy")).toHaveValue("Coś innego");
    expect(within(row).getByRole("button", { name: "Zapisz" })).toBeInTheDocument();
  });
});

describe("PanelPage — Zadeklarowane rzeczy (my pledges)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([]);
  });

  const myPledge: pledgesApi.MyPledgeResponse = {
    pledge_id: "7",
    status: "CLAIMED",
    product_name: "Bębenek",
    item_description: "mały",
    term_id: "3",
    group_id: "5",
    group_name: "Nutki",
    occurs_on: "2026-03-12T17:30:00",
    organizer_slug: "ania",
    registered: false,
  };

  it("renders a declared item and 'Rezygnuję' calls withdrawPledge then reloads", async () => {
    mockGuestDefaults();
    vi.mocked(pledgesApi.getMyPledges).mockResolvedValueOnce([myPledge]).mockResolvedValue([]);
    vi.mocked(pledgesApi.withdrawPledge).mockResolvedValue({
      id: "7",
      needed_item_id: "1",
      pledged_by_party_id: "1",
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
    await waitFor(() => expect(pledgesApi.withdrawPledge).toHaveBeenCalledWith("7"));
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

describe("PanelPage — Group 7 global pending-actions modal", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([]);
  });

  function pendingNotif(
    over: Partial<notificationsApi.NotificationResponse> = {},
  ): notificationsApi.NotificationResponse {
    return {
      id: "1",
      kind: "SWAP_PROPOSED",
      message: '„Marek" proponuje zamianę za: Rowerek',
      link_path: "/ania/grupa/5/term/3",
      read_at: null,
      created_at: "2026-03-01T10:00:00",
      reservation_id: null,
      ...over,
    };
  }

  // Accept/reject no longer happen from this global, one-at-a-time modal —
  // it can only ever surface the FIRST pending proposal, which would
  // pre-empt an actual choice among possibly several competing offers (see
  // `RzeczyView`'s per-item list of every offer). It only links to "Moje
  // rzeczy", where every pending offer against the item is shown together.
  it("renders an incoming swap prompt fed from pendingActions; 'Zobacz w Moje rzeczy' marks it read, switches to the rzeczy view and clears it from the modal", async () => {
    mockGuestDefaults();
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([pendingNotif()]);
    vi.mocked(notificationsApi.markNotificationRead).mockResolvedValue(undefined);
    renderPanel();

    const dialog = await screen.findByRole("dialog", { name: "Propozycja zamiany" });
    expect(within(dialog).getByText(/proponuje zamianę/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Akceptuj" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Odrzuć" })).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Zobacz w Moje rzeczy" }));

    await waitFor(() => expect(notificationsApi.markNotificationRead).toHaveBeenCalledWith("1"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Propozycja zamiany" })).not.toBeInTheDocument(),
    );
  });

  it("a proposal_id on the notification changes nothing — still just info and the 'Moje rzeczy' link, no accept/reject", async () => {
    mockGuestDefaults();
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([
      pendingNotif({ proposal_id: "42" }),
    ]);
    renderPanel();

    const dialog = await screen.findByRole("dialog", { name: "Propozycja zamiany" });
    expect(within(dialog).getByRole("button", { name: "Zobacz w Moje rzeczy" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Akceptuj" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Odrzuć" })).not.toBeInTheDocument();
  });

  it("renders a post-term-end confirm prompt for TERM_CONFIRMATION_NEEDED; without reservation_id, confirming falls back to resolving the reservation id from the term's listings then calls confirmTransaction", async () => {
    mockGuestDefaults();
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([
      pendingNotif({
        id: "2",
        kind: "TERM_CONFIRMATION_NEEDED",
        message: "Termin się odbył — potwierdź przekazanie rzeczy",
        link_path: "/ania/grupa/5/term/9",
      }),
    ]);
    vi.mocked(termItemListingsApi.getMyTakenTermItemListings).mockResolvedValue([
      browseListing({ id: "9", taken_by_party_id: mockProfile.party_id, resolved_reservation_id: "77" }),
    ]);
    vi.mocked(termItemListingsApi.getMyTermItemListings).mockResolvedValue([]);
    vi.mocked(reservationsApi.getReservation).mockResolvedValue({
      id: "77",
      item_id: "9",
      reservation_type: "GIFT",
      reserved_by_user_id: "1",
      paired_reservation_id: null,
      reserved_at: "",
      expires_at: null,
      status: "PENDING",
      notes: null,
    });
    vi.mocked(reservationsApi.confirmTransaction).mockResolvedValue({
      reservation_id: "77",
      status: "FULFILLED",
      already_resolved: false,
    });
    renderPanel();

    const dialog = await screen.findByRole("dialog", { name: "Potwierdź transakcję" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Potwierdź" }));

    await waitFor(() =>
      expect(reservationsApi.confirmTransaction).toHaveBeenCalledWith("77"),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Potwierdź transakcję" })).not.toBeInTheDocument(),
    );
  });

  it("confirms a TERM_CONFIRMATION_NEEDED action carrying reservation_id (Pledge-LEND) directly via confirmTransaction, without the resolver", async () => {
    mockGuestDefaults();
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([
      pendingNotif({
        id: "2",
        kind: "TERM_CONFIRMATION_NEEDED",
        message: "Termin się odbył — potwierdź przekazanie rzeczy",
        link_path: "/ania/grupa/5/term/9",
        reservation_id: "501",
      }),
    ]);
    vi.mocked(notificationsApi.markNotificationRead).mockResolvedValue(undefined);
    vi.mocked(reservationsApi.confirmTransaction).mockResolvedValue({
      reservation_id: "501",
      status: "CONFIRMED",
      already_resolved: false,
    });
    renderPanel();

    const dialog = await screen.findByRole("dialog", { name: "Potwierdź transakcję" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Potwierdź" }));

    await waitFor(() => expect(reservationsApi.confirmTransaction).toHaveBeenCalledWith("501"));
    expect(termItemListingsApi.getMyTakenTermItemListings).not.toHaveBeenCalled();
    expect(termItemListingsApi.getMyTermItemListings).not.toHaveBeenCalled();
    expect(reservationsApi.getReservation).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Potwierdzono"));
  });

  it("confirms via reservation_id even when the notification's link carries no term id", async () => {
    mockGuestDefaults();
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([
      pendingNotif({
        id: "2",
        kind: "TERM_CONFIRMATION_NEEDED",
        message: "Termin się odbył — potwierdź przekazanie rzeczy",
        link_path: null,
        reservation_id: "502",
      }),
    ]);
    vi.mocked(notificationsApi.markNotificationRead).mockResolvedValue(undefined);
    vi.mocked(reservationsApi.confirmTransaction).mockResolvedValue({
      reservation_id: "502",
      status: "CONFIRMED",
      already_resolved: false,
    });
    renderPanel();

    const dialog = await screen.findByRole("dialog", { name: "Potwierdź transakcję" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Potwierdź" }));

    await waitFor(() => expect(reservationsApi.confirmTransaction).toHaveBeenCalledWith("502"));
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
        id: "2",
        kind: "TERM_CONFIRMATION_NEEDED",
        message: "Termin się odbył — potwierdź przekazanie rzeczy",
        link_path: "/ania/grupa/5/term/9",
      }),
    ]);
    vi.mocked(termItemListingsApi.getMyTakenTermItemListings).mockResolvedValue([
      browseListing({ id: "9", taken_by_party_id: mockProfile.party_id, resolved_reservation_id: "77" }),
    ]);
    vi.mocked(termItemListingsApi.getMyTermItemListings).mockResolvedValue([]);
    vi.mocked(reservationsApi.getReservation).mockResolvedValue({
      id: "77",
      item_id: "9",
      reservation_type: "GIFT",
      reserved_by_user_id: "1",
      paired_reservation_id: null,
      reserved_at: "",
      expires_at: null,
      status: "PENDING",
      notes: null,
    });
    vi.mocked(reservationsApi.confirmTransaction).mockResolvedValue({
      reservation_id: "77",
      status: "FULFILLED",
      already_resolved: false,
    });
    renderPanel();

    const dialog = await screen.findByRole("dialog", { name: "Potwierdź transakcję" });
    await waitFor(() => expect(inventoriesApi.getMyInventoryItems).toHaveBeenCalledTimes(1));

    fireEvent.click(within(dialog).getByRole("button", { name: "Potwierdź" }));

    await waitFor(() =>
      expect(reservationsApi.confirmTransaction).toHaveBeenCalledWith("77"),
    );
    // A second `getMyInventoryItems` call is the signal that `load({ silent: true })`
    // re-ran after the confirm, not just `dismissPendingAction`.
    await waitFor(() => expect(inventoriesApi.getMyInventoryItems).toHaveBeenCalledTimes(2));
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
        id: "2",
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
      browseListing({ id: "9", taken_by_party_id: mockProfile.party_id, resolved_reservation_id: "77" }),
    ]);
    vi.mocked(reservationsApi.getReservation).mockResolvedValue({
      id: "77",
      item_id: "9",
      reservation_type: "GIFT",
      reserved_by_user_id: "1",
      paired_reservation_id: null,
      reserved_at: "",
      expires_at: null,
      status: "PENDING",
      notes: null,
    });
    vi.mocked(reservationsApi.confirmTransaction).mockResolvedValue({
      reservation_id: "77",
      status: "FULFILLED",
      already_resolved: false,
    });
    renderPanel();

    const dialog = await screen.findByRole("dialog", { name: "Potwierdź transakcję" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Potwierdź" }));

    await waitFor(() =>
      expect(reservationsApi.confirmTransaction).toHaveBeenCalledWith("77"),
    );
  });

  it("confirming a race after losing it shows the distinct 'already resolved' message instead of a generic error", async () => {
    mockGuestDefaults();
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([
      pendingNotif({
        id: "2",
        kind: "TERM_CONFIRMATION_NEEDED",
        message: "Termin się odbył — potwierdź przekazanie rzeczy",
        link_path: "/ania/grupa/5/term/9",
      }),
    ]);
    vi.mocked(termItemListingsApi.getMyTakenTermItemListings).mockResolvedValue([
      browseListing({ id: "9", taken_by_party_id: mockProfile.party_id, resolved_reservation_id: "77" }),
    ]);
    vi.mocked(termItemListingsApi.getMyTermItemListings).mockResolvedValue([]);
    vi.mocked(reservationsApi.getReservation).mockResolvedValue({
      id: "77",
      item_id: "9",
      reservation_type: "GIFT",
      reserved_by_user_id: "1",
      paired_reservation_id: null,
      reserved_at: "",
      expires_at: null,
      status: "PENDING",
      notes: null,
    });
    vi.mocked(reservationsApi.confirmTransaction).mockRejectedValue(
      new ApiError(409, "Conflict", { reservation_id: "77", status: "ALREADY_RESOLVED", already_resolved: true }),
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
        id: "2",
        kind: "TERM_CONFIRMATION_NEEDED",
        message: "Termin się odbył — potwierdź przekazanie rzeczy",
        link_path: "/ania/grupa/5/term/9",
      }),
    ]);
    // Taker side finds nothing — the caller is the lister here.
    vi.mocked(termItemListingsApi.getMyTakenTermItemListings).mockResolvedValue([]);
    vi.mocked(termItemListingsApi.getMyTermItemListings).mockResolvedValue([
      browseListing({ id: "9", lister_party_id: mockProfile.party_id, resolved_reservation_id: "55" }),
    ]);
    vi.mocked(reservationsApi.getReservation).mockResolvedValue({
      id: "55",
      item_id: "9",
      reservation_type: "GIFT",
      reserved_by_user_id: "2",
      paired_reservation_id: null,
      reserved_at: "",
      expires_at: null,
      status: "PENDING",
      notes: null,
    });
    vi.mocked(reservationsApi.confirmTransaction).mockResolvedValue({
      reservation_id: "55",
      status: "FULFILLED",
      already_resolved: false,
    });
    renderPanel();

    const dialog = await screen.findByRole("dialog", { name: "Potwierdź transakcję" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Potwierdź" }));

    await waitFor(() =>
      expect(reservationsApi.confirmTransaction).toHaveBeenCalledWith("55"),
    );
  });

  // Regression: the pre-existing SWAP paired-leg resolution branch (owner
  // side of an accepted SWAP resolves via the paired leg, not primary.id
  // directly) must remain unchanged by the GIFT/LEND addition above.
  it("still resolves the SWAP paired-leg reservation id for the owner side, unchanged", async () => {
    mockGuestDefaults();
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([
      pendingNotif({
        id: "2",
        kind: "TERM_CONFIRMATION_NEEDED",
        message: "Termin się odbył — potwierdź przekazanie rzeczy",
        link_path: "/ania/grupa/5/term/9",
      }),
    ]);
    vi.mocked(termItemListingsApi.getMyTakenTermItemListings).mockResolvedValue([]);
    vi.mocked(termItemListingsApi.getMyTermItemListings).mockResolvedValue([
      browseListing({ id: "9", lister_party_id: mockProfile.party_id, resolved_reservation_id: "60" }),
    ]);
    vi.mocked(reservationsApi.getReservation).mockImplementation(async (id: string) => {
      if (id === "60") {
        return {
          id: "60",
          item_id: "9",
          reservation_type: "SWAP",
          reserved_by_user_id: "2",
          paired_reservation_id: "61",
          reserved_at: "",
          expires_at: null,
          status: "PENDING",
          notes: null,
        };
      }
      return {
        id: "61",
        item_id: "12",
        reservation_type: "SWAP",
        reserved_by_user_id: "1",
        paired_reservation_id: "60",
        reserved_at: "",
        expires_at: null,
        status: "PENDING",
        notes: null,
      };
    });
    vi.mocked(reservationsApi.confirmTransaction).mockResolvedValue({
      reservation_id: "61",
      status: "FULFILLED",
      already_resolved: false,
    });
    renderPanel();

    const dialog = await screen.findByRole("dialog", { name: "Potwierdź transakcję" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Potwierdź" }));

    await waitFor(() =>
      expect(reservationsApi.confirmTransaction).toHaveBeenCalledWith("61"),
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
        id: "2",
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
      expect(notificationsApi.markNotificationRead).toHaveBeenCalledWith("2"),
    );
  });

  it("read notifications never surface as pending actions — only the unread TERM_CONFIRMATION_NEEDED one renders", async () => {
    mockGuestDefaults();
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([
      pendingNotif({ id: "1", read_at: "2026-03-01T11:00:00" }),
      pendingNotif({
        id: "2",
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
    vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([]);
  });

  const lockedItem = {
    id: "30",
    inventory_id: "1",
    home_inventory_id: null,
    product_id: "8",
    product_name: "Wiertarka",
    condition: "GOOD" as const,
    added_at: "",
    created_at: "",
    updated_at: "",
    listing_mode: null,
    photos_moderation_pending: false,
  };

  it("dismissing the global confirm prompt still leaves the tile's own 'Odebrał' fallback usable — clicking it confirms the transaction and silently refreshes the panel", async () => {
    mockGuestDefaults();
    vi.mocked(inventoriesApi.getMyInventoryItems).mockResolvedValue([lockedItem]);
    vi.mocked(inventoriesApi.getInventoryItemBalances).mockResolvedValue({
      [lockedItem.id]: { status: "IN_TRANSIT", reservationId: "88" },
    });
    vi.mocked(reservationsApi.getReservation).mockResolvedValue({
      id: "88",
      item_id: lockedItem.id,
      reservation_type: "LEND",
      reserved_by_user_id: "1",
      term_id: ENDED_TERM_ID,
      paired_reservation_id: null,
      reserved_at: "",
      expires_at: null,
      status: "CONFIRMED",
      notes: null,
    });
    vi.mocked(termsApi.getTerm).mockResolvedValue({
      id: ENDED_TERM_ID,
      circle_group_id: GROUP_ID,
      occurs_on: "2020-01-01T10:00:00", // long past — term has ended
      description: null,
      created_at: "",
      updated_at: "",
      attendee_count: null,
      child_count: null,
    });
    // A TERM_CONFIRMATION_NEEDED prompt also happens to be pending (e.g.
    // for a different reservation) — dismissing it via "Później" must not
    // interfere with the independent, tile-local fallback below.
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([
      {
        id: "1",
        kind: "TERM_CONFIRMATION_NEEDED",
        message: "Termin się odbył — potwierdź przekazanie rzeczy",
        link_path: "/ania/grupa/5/term/9",
        read_at: null,
        created_at: "2026-03-01T10:00:00",
        reservation_id: null,
      },
    ]);
    vi.mocked(notificationsApi.markNotificationRead).mockResolvedValue(undefined);
    vi.mocked(reservationsApi.confirmTransaction).mockResolvedValue({
      reservation_id: "88",
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
    await waitFor(() => expect(inventoriesApi.getMyInventoryItems).toHaveBeenCalledTimes(1));

    const odebral = await screen.findByRole("button", { name: "Odebrał" });
    fireEvent.click(odebral);

    await waitFor(() =>
      expect(reservationsApi.confirmTransaction).toHaveBeenCalledWith("88"),
    );
    // A second `getMyInventoryItems` call is the signal that `load({ silent:
    // true })` re-ran after the confirm (same convention as Bug #3's own
    // TERM_CONFIRMATION_NEEDED refresh test above).
    await waitFor(() => expect(inventoriesApi.getMyInventoryItems).toHaveBeenCalledTimes(2));
  });
});

describe("PanelPage — organizer join-request pending action", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([]);
  });

  function joinRequest(
    over: Partial<groupsApi.PendingJoinRequestResponse> = {},
  ): groupsApi.PendingJoinRequestResponse {
    return {
      id: "11",
      group_id: "5",
      group_name: "Poranne Maluchy",
      term_id: "3",
      requester_party_id: "42",
      requester_display_name: "Kasia Nowak",
      created_at: "2026-09-24T10:00:00",
      ...over,
    };
  }

  function joinNotif(
    over: Partial<notificationsApi.NotificationResponse> = {},
  ): notificationsApi.NotificationResponse {
    return {
      id: "70",
      kind: "GROUP_JOIN_REQUESTED",
      message: "Kasia Nowak prosi o dostęp do grupy „Poranne Maluchy”",
      link_path: "/ania/grupa/5/term/3",
      read_at: null,
      created_at: "2026-09-24T10:00:00",
      join_request_id: "11",
      reservation_id: null,
      ...over,
    };
  }

  const decided = (status: groupsApi.JoinRequestStatus): groupsApi.JoinRequestResponse => ({
    id: "11",
    group_id: "5",
    requester_party_id: "42",
    term_id: "3",
    status,
    created_at: "",
    updated_at: "",
  });

  it("shows the server-listed request even when its notification is already read", async () => {
    mockOrganizerDefaults();
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([
      joinNotif({ read_at: "2026-09-24T11:00:00" }),
    ]);
    vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([joinRequest()]);
    renderPanel();

    const dialog = await screen.findByRole("dialog", { name: "Prośba o dostęp" });
    expect(within(dialog).getByText(/Kasia Nowak prosi o dostęp do grupy/)).toBeInTheDocument();
    expect(within(dialog).getByText("„Poranne Maluchy”")).toBeInTheDocument();
    expect(within(dialog).getByText("Wysłano 24 września")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Zatwierdź" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Odrzuć" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Później" })).toBeInTheDocument();
  });

  it("Zatwierdź shows a busy state, approves, marks the linked notification read, reloads and toasts", async () => {
    mockOrganizerDefaults();
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([joinNotif()]);
    vi.mocked(notificationsApi.markNotificationRead).mockResolvedValue(undefined);
    vi.mocked(groupsApi.listMyPendingJoinRequests)
      .mockResolvedValueOnce([joinRequest()])
      .mockResolvedValue([]);
    let resolveApprove: (value: groupsApi.JoinRequestResponse) => void = () => undefined;
    vi.mocked(groupsApi.approveJoinRequest).mockReturnValue(
      new Promise((resolve) => {
        resolveApprove = resolve;
      }),
    );
    renderPanel();

    const dialog = await screen.findByRole("dialog", { name: "Prośba o dostęp" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Zatwierdź" }));

    const busyButton = await within(dialog).findByRole("button", { name: "Zatwierdzanie…" });
    expect(busyButton).toBeDisabled();
    expect(busyButton).toHaveAttribute("aria-busy", "true");
    expect(within(dialog).getByRole("button", { name: "Odrzuć" })).toBeDisabled();
    expect(groupsApi.approveJoinRequest).toHaveBeenCalledWith("5", "11");

    resolveApprove(decided("APPROVED"));

    expect(await screen.findByText("Prośba zatwierdzona")).toBeInTheDocument();
    expect(notificationsApi.markNotificationRead).toHaveBeenCalledWith("70");
    expect(groupsApi.listMyPendingJoinRequests).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog", { name: "Prośba o dostęp" })).not.toBeInTheDocument();
  });

  it("Odrzuć rejects without extra confirmation; a non-409 failure shows a retryable alert first", async () => {
    mockOrganizerDefaults();
    vi.mocked(groupsApi.listMyPendingJoinRequests)
      .mockResolvedValueOnce([joinRequest()])
      .mockResolvedValue([]);
    vi.mocked(groupsApi.rejectJoinRequest)
      .mockRejectedValueOnce(new ApiError(500, "Server Error", null))
      .mockResolvedValueOnce(decided("REJECTED"));
    renderPanel();

    const dialog = await screen.findByRole("dialog", { name: "Prośba o dostęp" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Odrzuć" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Nie udało się zapisać decyzji — spróbuj ponownie",
    );

    fireEvent.click(within(dialog).getByRole("button", { name: "Odrzuć" }));

    expect(await screen.findByText("Prośba odrzucona")).toBeInTheDocument();
    expect(groupsApi.rejectJoinRequest).toHaveBeenLastCalledWith("5", "11");
    expect(groupsApi.approveJoinRequest).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Prośba o dostęp" })).not.toBeInTheDocument();
  });

  it("any 409 shows the already-resolved state; Rozumiem dismisses and reloads", async () => {
    mockOrganizerDefaults();
    vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([joinRequest()]);
    vi.mocked(groupsApi.approveJoinRequest).mockRejectedValue(
      new ApiError(409, "Conflict", { detail: "Join request is no longer pending" }),
    );
    renderPanel();

    const dialog = await screen.findByRole("dialog", { name: "Prośba o dostęp" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Zatwierdź" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Prośba została już rozstrzygnięta.",
    );
    expect(within(dialog).queryByRole("button", { name: "Zatwierdź" })).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Rozumiem" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Prośba o dostęp" })).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(groupsApi.listMyPendingJoinRequests).toHaveBeenCalledTimes(2));
  });

  it("Później hides the item without touching notifications and reveals the next one", async () => {
    mockOrganizerDefaults();
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([joinNotif()]);
    // The server lists pending requests oldest first; the panel keeps that order.
    vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([
      joinRequest(),
      joinRequest({ id: "12", requester_display_name: "Ola Zielińska", created_at: "2026-09-24T12:00:00" }),
    ]);
    renderPanel();

    const dialog = await screen.findByRole("dialog", { name: "Prośba o dostęp" });
    expect(within(dialog).getByText(/Kasia Nowak prosi/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Później" }));

    expect(
      await within(screen.getByRole("dialog", { name: "Prośba o dostęp" })).findByText(/Ola Zielińska prosi/),
    ).toBeInTheDocument();
    expect(notificationsApi.markNotificationRead).not.toHaveBeenCalled();
  });

  it("an item hidden with Później stays hidden across a silent reload", async () => {
    mockOrganizerDefaults();
    const older = joinRequest();
    const newer = joinRequest({ id: "12", requester_display_name: "Ola Zielińska", created_at: "2026-09-24T12:00:00" });
    vi.mocked(groupsApi.listMyPendingJoinRequests)
      .mockResolvedValueOnce([older, newer])
      .mockResolvedValue([older]);
    vi.mocked(groupsApi.approveJoinRequest).mockResolvedValue(decided("APPROVED"));
    renderPanel();

    const dialog = await screen.findByRole("dialog", { name: "Prośba o dostęp" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Później" }));

    const next = screen.getByRole("dialog", { name: "Prośba o dostęp" });
    expect(within(next).getByText(/Ola Zielińska prosi/)).toBeInTheDocument();
    fireEvent.click(within(next).getByRole("button", { name: "Zatwierdź" }));

    expect(await screen.findByText("Prośba zatwierdzona")).toBeInTheDocument();
    expect(groupsApi.approveJoinRequest).toHaveBeenCalledWith("5", "12");
    expect(groupsApi.listMyPendingJoinRequests).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog", { name: "Prośba o dostęp" })).not.toBeInTheDocument();
  });

  it("an undefined pending-requests result still renders the panel with no item", async () => {
    mockOrganizerDefaults();
    vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue(
      undefined as unknown as groupsApi.PendingJoinRequestResponse[],
    );
    renderPanel();

    expect(await screen.findByRole("button", { name: "Powiadomienia" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Prośba o dostęp" })).not.toBeInTheDocument();
    expect(screen.queryByText("Nie udało się wczytać panelu")).not.toBeInTheDocument();
  });

  it("a failed pending-requests fetch is logged and the panel still renders", async () => {
    mockOrganizerDefaults();
    const failure = new Error("500");
    vi.mocked(groupsApi.listMyPendingJoinRequests).mockRejectedValue(failure);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      renderPanel();

      expect(await screen.findByRole("button", { name: "Powiadomienia" })).toBeInTheDocument();
      expect(screen.queryByText("Nie udało się wczytać panelu")).not.toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: "Prośba o dostęp" })).not.toBeInTheDocument();
      expect(consoleError).toHaveBeenCalledWith(expect.any(String), failure);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("a GROUP_JOIN_REQUESTED row in the header bell renders its message, marks it read on open and keeps the pending action", async () => {
    mockOrganizerDefaults();
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([joinNotif({ link_path: "/panel" })]);
    vi.mocked(notificationsApi.markNotificationRead).mockResolvedValue(undefined);
    vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([joinRequest()]);
    // The bell lives in the top account bar (PublicLayout), above the Panel;
    // both read the same notifications query.
    render(
      <MemoryRouter initialEntries={["/panel"]}>
        <NotificationBell />
        <Routes>
          <Route path="/panel" element={<PanelPage />} />
        </Routes>
      </MemoryRouter>,
      { wrapper: createQueryWrapper() },
    );

    await screen.findByRole("dialog", { name: "Prośba o dostęp" });
    fireEvent.click(screen.getByRole("button", { name: /Powiadomienia \(1 nieprzeczytane\)/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Kasia Nowak prosi o dostęp do grupy/ }));

    await waitFor(() => expect(notificationsApi.markNotificationRead).toHaveBeenCalledWith("70"));
    expect(screen.getByRole("dialog", { name: "Prośba o dostęp" })).toBeInTheDocument();
  });
});

describe("PanelPage — Mój dom — inline birth-year editor and returnTo (gap tests)", () => {
  const RETURN_PATH = "/x/grupa/1/term/2";

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([]);
  });

  it("Esc cancels the inline edit without saving; an out-of-range year disables Zapisz", async () => {
    mockGuestDefaults();
    vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([mockFamily]);
    vi.mocked(familiesApi.getGuardians).mockResolvedValue(mockGuardians);
    renderPanel("/panel/rodzina");
    await screen.findByRole("heading", { name: "Mój dom", level: 2 });

    fireEvent.click(screen.getByRole("button", { name: "Edytuj rok urodzenia: Zosia Kowalska" }));
    const input = screen.getByLabelText("Rok urodzenia: Zosia Kowalska");
    fireEvent.change(input, { target: { value: String(new Date().getFullYear() + 1) } });
    expect(screen.getByRole("button", { name: "Zapisz" })).toBeDisabled();

    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByLabelText("Rok urodzenia: Zosia Kowalska")).not.toBeInTheDocument();
    expect(screen.getByText(`rocznik 2018 · ${formatApproxAge(approxAge(2018))}`)).toBeInTheDocument();
    expect(familiesApi.updateChildBirthYear).not.toHaveBeenCalled();
  });

  it("closing CreateFamilyDialog mid-flow keeps the 'Wróć do terminu' link", async () => {
    mockGuestDefaults();
    renderPanel(`/panel/rodzina?returnTo=${encodeURIComponent(RETURN_PATH)}`);
    fireEvent.click(await screen.findByRole("button", { name: "Załóż rodzinę" }));

    const dialog = await screen.findByRole("dialog", { name: "Załóż rodzinę" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Zamknij" }));

    expect(screen.queryByRole("dialog", { name: "Załóż rodzinę" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Wróć do terminu" })).toHaveAttribute("href", RETURN_PATH);
    expect(familiesApi.createOwnFamily).not.toHaveBeenCalled();
  });
});

describe("PanelPage — moderation errors inline in the add-group / add-term / edit-group modals", () => {
  const GROUP_NAME_REJECTED = "Nazwa grupy narusza zasady społeczności. Zmień ją i spróbuj ponownie.";
  const PRODUCT_NAME_REJECTED = "Nazwa rzeczy narusza zasady społeczności. Zmień ją i spróbuj ponownie.";

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([]);
    mockOrganizerDefaults();
  });

  async function openAddGroupDialog() {
    fireEvent.click(await screen.findByRole("button", { name: "Spotkania" }));
    fireEvent.click(await screen.findByRole("button", { name: "+ Dodaj grupę" }));
    return screen.findByRole("dialog", { name: "Dodaj nową grupę" });
  }

  async function openAddTermDialogWithDraftItem(itemName: string) {
    fireEvent.click(await screen.findByRole("button", { name: "Spotkania" }));
    fireEvent.click(await screen.findByRole("button", { name: "+ Dodaj termin" }));
    const dialog = await screen.findByRole("dialog", { name: "Dodaj termin zajęć" });
    const dateInput = dialog.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
    fireEvent.change(dateInput, { target: { value: "2026-02-01T17:00" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "+ Dodaj potrzebną rzecz" }));
    fireEvent.change(within(dialog).getByLabelText("Nazwa"), { target: { value: itemName } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj rzecz" }));
    return dialog;
  }

  it("add group: a server-rejected name shows an inline alert, no toast, and keeps the modal open with its input", async () => {
    vi.mocked(groupsApi.createAdditionalMyCircle).mockRejectedValue(
      new ApiError(400, "Bad Request", { message: GROUP_NAME_REJECTED }),
    );
    renderPanel();
    const dialog = await openAddGroupDialog();

    fireEvent.change(within(dialog).getByPlaceholderText("np. Nutki dla starszaków"), { target: { value: "Zła nazwa" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj grupę" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(GROUP_NAME_REJECTED);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Dodaj nową grupę" })).toBeInTheDocument();
    expect(within(dialog).getByPlaceholderText("np. Nutki dla starszaków")).toHaveValue("Zła nazwa");
  });

  it("add group: reopening the modal clears the previous inline error", async () => {
    vi.mocked(groupsApi.createAdditionalMyCircle).mockRejectedValue(
      new ApiError(400, "Bad Request", { message: GROUP_NAME_REJECTED }),
    );
    renderPanel();
    let dialog = await openAddGroupDialog();
    fireEvent.change(within(dialog).getByPlaceholderText("np. Nutki dla starszaków"), { target: { value: "Zła nazwa" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj grupę" }));
    await within(dialog).findByRole("alert");

    fireEvent.click(within(dialog).getByRole("button", { name: "Zamknij" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Dodaj nową grupę" })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "+ Dodaj grupę" }));
    dialog = await screen.findByRole("dialog", { name: "Dodaj nową grupę" });

    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("add term: a rejected needed-item name never creates the term and shows an inline alert", async () => {
    vi.mocked(productsApi.resolveProduct).mockRejectedValue(
      new ApiError(400, "Bad Request", { message: PRODUCT_NAME_REJECTED }),
    );
    renderPanel();
    const dialog = await openAddTermDialogWithDraftItem("Zła rzecz");

    fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj termin" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(PRODUCT_NAME_REJECTED);
    expect(termsApi.createTerm).not.toHaveBeenCalled();
    expect(termsApi.createNeededItem).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Dodaj termin zajęć" })).toBeInTheDocument();
  });

  it("add term: resolves every needed item before createTerm, then creates the needed items", async () => {
    const calls: string[] = [];
    vi.mocked(productsApi.resolveProduct).mockImplementation(async () => {
      calls.push("resolveProduct");
      return { id: "p-1" } as Awaited<ReturnType<typeof productsApi.resolveProduct>>;
    });
    vi.mocked(termsApi.createTerm).mockImplementation(async () => {
      calls.push("createTerm");
      return {
        id: TERM_ID, circle_group_id: GROUP_ID, occurs_on: "2026-02-01", description: null,
        created_at: "", updated_at: "", attendee_count: null, child_count: null,
      };
    });
    vi.mocked(termsApi.createNeededItem).mockImplementation(async () => {
      calls.push("createNeededItem");
      return {} as Awaited<ReturnType<typeof termsApi.createNeededItem>>;
    });
    renderPanel();
    const dialog = await openAddTermDialogWithDraftItem("Mata");

    fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj termin" }));

    await waitFor(() => expect(calls).toEqual(["resolveProduct", "createTerm", "createNeededItem"]));
    expect(termsApi.createNeededItem).toHaveBeenCalledWith({ term_id: TERM_ID, product_id: "p-1", description: undefined });
  });

  it("edit group: a server-rejected name shows the server message in an alert", async () => {
    vi.mocked(groupsApi.updateGroupLayoutMode).mockRejectedValue(
      new ApiError(400, "Bad Request", { message: GROUP_NAME_REJECTED }),
    );
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Spotkania" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edytuj grupę Nowa grupa" }));
    const dialog = await screen.findByRole("dialog", { name: "Edytuj grupę" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Zapisz" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(GROUP_NAME_REJECTED);
  });
});

describe("PanelPage — profil", () => {
  const PROFILE_NAME_REJECTED = "Imię i nazwisko narusza zasady społeczności. Zmień je i spróbuj ponownie.";

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([]);
  });

  it("/panel/profil edits name and 'O mnie' (no location field) and saves them", async () => {
    mockGuestDefaults();
    vi.mocked(peopleApi.updateMyProfile).mockResolvedValue({
      ...mockProfile,
      display_name: "Jan Nowak",
      bio: "Tata dwójki",
    });
    renderPanel("/panel/profil");

    const name = await screen.findByLabelText("Imię i nazwisko");
    expect(name).toHaveValue("Jan Kowalski");
    expect(screen.queryByLabelText("Lokalizacja")).not.toBeInTheDocument();
    fireEvent.change(name, { target: { value: "Jan Nowak" } });
    fireEvent.change(screen.getByLabelText("O mnie"), { target: { value: "Tata dwójki" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz zmiany" }));

    await waitFor(() =>
      expect(peopleApi.updateMyProfile).toHaveBeenCalledWith({ display_name: "Jan Nowak", bio: "Tata dwójki" }),
    );
    expect(await screen.findByText("✓ Zapisano")).toBeInTheDocument();
  });

  it("shows the moderation message when the name is rejected", async () => {
    mockGuestDefaults();
    vi.mocked(peopleApi.updateMyProfile).mockRejectedValue(
      new ApiError(400, "Bad Request", { message: PROFILE_NAME_REJECTED }),
    );
    renderPanel("/panel/profil");

    fireEvent.change(await screen.findByLabelText("Imię i nazwisko"), { target: { value: "brzydko" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz zmiany" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(PROFILE_NAME_REJECTED);
  });

  it("uploads an avatar, shows it with the pending note, and removes it", async () => {
    mockGuestDefaults();
    vi.mocked(peopleApi.uploadMyAvatar).mockResolvedValue({
      url: "https://origin.test/avatars/1/a/w400.webp?signed",
      status: "PENDING",
    });
    vi.mocked(peopleApi.deleteMyAvatar).mockResolvedValue(undefined);
    renderPanel("/panel/profil");

    const file = new File(["png"], "me.png", { type: "image/png" });
    fireEvent.change(await screen.findByLabelText("Zdjęcie profilowe"), { target: { files: [file] } });

    expect(await screen.findByAltText("Twoje zdjęcie profilowe")).toHaveAttribute(
      "src",
      "https://origin.test/avatars/1/a/w400.webp?signed",
    );
    expect(peopleApi.uploadMyAvatar).toHaveBeenCalledWith(file);
    expect(screen.getByText(/Zdjęcie czeka na moderację —/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Usuń" }));

    await waitFor(() => expect(screen.queryByAltText("Twoje zdjęcie profilowe")).not.toBeInTheDocument());
    expect(peopleApi.deleteMyAvatar).toHaveBeenCalled();
  });
});
