import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as familiesApi from "../api/families";
import * as groupsApi from "../api/groups";
import * as inventoriesApi from "../api/inventories";
import * as peopleApi from "../api/people";
import * as pledgesApi from "../api/pledges";
import * as productsApi from "../api/products";
import * as reservationsApi from "../api/reservations";
import * as termItemListingsApi from "../api/termItemListings";
import * as termsApi from "../api/terms";
import * as itemListingPreferencesApi from "../api/itemListingPreferences";
import { useKragGrupy } from "../hooks/useKragGrupy";

vi.mock("../api/families", () => ({
  getFamiliesForGuardianParty: vi.fn(),
  getGuardians: vi.fn(),
}));

vi.mock("../api/groups", () => ({
  getCurrentLeadership: vi.fn(),
  getGroup: vi.fn(),
  getGroupExchangeSummary: vi.fn(),
  getFamilyExchangeOffers: vi.fn(),
  getMembershipsForCircle: vi.fn(),
  getMyAttendances: vi.fn(),
  updateGroupLayoutMode: vi.fn(),
  withdrawMyAttendance: vi.fn(),
  getTermAttendeesForFormalization: vi.fn(),
  formalizeGroupFromTerm: vi.fn(),
}));

vi.mock("../api/pledges", () => ({
  createPledge: vi.fn(),
  fulfillPledge: vi.fn(),
  getPledges: vi.fn(),
  syncPledgeFulfillment: vi.fn(),
  withdrawPledge: vi.fn(),
}));

vi.mock("../api/inventories", () => ({
  getInventories: vi.fn(),
  getInventoryItemBalance: vi.fn(),
  getInventoryItems: vi.fn(),
}));

vi.mock("../api/people", () => ({
  getMyProfile: vi.fn(),
  getProfileByParty: vi.fn(),
}));

vi.mock("../api/products", () => ({
  getProducts: vi.fn(),
}));

vi.mock("../api/reservations", () => ({
  confirmReservation: vi.fn(),
  fulfillReservation: vi.fn(),
  confirmTransaction: vi.fn(),
}));

vi.mock("../api/terms", () => ({
  getNeededItems: vi.fn(),
  getTerms: vi.fn(),
}));

vi.mock("../api/termItemListings", () => ({
  getMyTermItemListings: vi.fn(),
  getBrowseTermItemListings: vi.fn(),
  takeTermItemListing: vi.fn(),
}));

vi.mock("../api/itemListingPreferences", () => ({
  getMyItemListingPreferences: vi.fn(),
}));

const GROUP_ID = 1;

const term = {
  id: 100,
  circle_group_id: GROUP_ID,
  occurs_on: "2026-10-01T17:00:00",
  description: null,
  created_at: "2026-01-01T00:00:00",
  updated_at: "2026-01-01T00:00:00",
};

const groupResponse: groupsApi.GroupResponse = {
  id: GROUP_ID,
  party_id: 5,
  name: "Test Circle",
  organizer_slug: "test-circle",
  layout_mode: "CIRCLE",
  visibility: "PUBLIC",
  created_at: "2026-01-01T00:00:00",
  updated_at: "2026-01-01T00:00:00",
};

const familyFixture: familiesApi.FamilyOut = {
  id: 10,
  party_id: 70,
  name: "Rodzina Kowalskich",
  created_at: "2026-01-01T00:00:00",
  updated_at: "2026-01-01T00:00:00",
  child_count: 0,
};

const guardianFixture: familiesApi.GuardianResponse = {
  family_membership_id: 1,
  party_id: 7,
  user_profile_id: 2,
  display_name: "Anna Kowalska",
  email: "anna@example.com",
  is_primary_contact: true,
  valid_from: "2026-01-01",
  valid_to: null,
};

const membershipFixture: groupsApi.MembershipResponse = {
  id: 1,
  from_role_id: 1,
  to_group_id: GROUP_ID,
  member_party_id: 7,
  valid_from: "2026-01-01",
  valid_to: null,
};

/** Wires the membership -> family -> guardians chain so `families` resolves
 * to exactly `[familyFixture]` — several of this group's tests need a real
 * family present to assert on `sharesItem`/`bringsItem`. */
function setupSingleFamily() {
  vi.mocked(groupsApi.getMembershipsForCircle).mockResolvedValue([membershipFixture]);
  vi.mocked(familiesApi.getFamiliesForGuardianParty).mockResolvedValue([familyFixture]);
  vi.mocked(familiesApi.getGuardians).mockResolvedValue([guardianFixture]);
}

function myProfile(overrides: Partial<peopleApi.UserProfileResponse> = {}): peopleApi.UserProfileResponse {
  return {
    id: 9,
    party_id: 42,
    account_user_id: null,
    display_name: "Kasia",
    email: "kasia@example.com",
    created_at: "2026-01-01T00:00:00",
    updated_at: "2026-01-01T00:00:00",
    is_organizer: false,
    ...overrides,
  };
}

function leadership(overrides: Partial<groupsApi.LeadershipResponse> = {}): groupsApi.LeadershipResponse {
  return {
    id: 1,
    from_role_id: 1,
    to_group_id: GROUP_ID,
    organizer_party_id: 999,
    valid_from: "2026-01-01",
    valid_to: null,
    ...overrides,
  };
}

function attendance(overrides: Partial<groupsApi.MyAttendanceResponse> = {}): groupsApi.MyAttendanceResponse {
  return {
    attendance_id: 1,
    term_id: term.id,
    occurs_on: term.occurs_on,
    child_count: 1,
    group_id: GROUP_ID,
    group_name: groupResponse.name,
    organizer_display_name: null,
    organizer_slug: groupResponse.organizer_slug!,
    ...overrides,
  };
}

/** Wires up every mock to a minimal, self-consistent happy-path default.
 * Individual tests override just the calls relevant to what they assert. */
function setupDefaultMocks() {
  vi.resetAllMocks();
  vi.mocked(groupsApi.getGroup).mockResolvedValue(groupResponse);
  vi.mocked(groupsApi.getCurrentLeadership).mockResolvedValue(null);
  vi.mocked(groupsApi.getMembershipsForCircle).mockResolvedValue([]);
  vi.mocked(groupsApi.getMyAttendances).mockResolvedValue([]);
  vi.mocked(groupsApi.getGroupExchangeSummary).mockResolvedValue({ families: [] });
  vi.mocked(groupsApi.getFamilyExchangeOffers).mockResolvedValue({ family_id: 0, offers: [] });
  vi.mocked(groupsApi.updateGroupLayoutMode).mockResolvedValue(groupResponse);
  vi.mocked(familiesApi.getFamiliesForGuardianParty).mockResolvedValue([]);
  vi.mocked(familiesApi.getGuardians).mockResolvedValue([]);
  vi.mocked(termsApi.getTerms).mockResolvedValue([term]);
  vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
  vi.mocked(peopleApi.getMyProfile).mockResolvedValue(myProfile());
  vi.mocked(peopleApi.getProfileByParty).mockResolvedValue(myProfile({ party_id: 999 }));
  vi.mocked(productsApi.getProducts).mockResolvedValue([]);
  vi.mocked(pledgesApi.getPledges).mockResolvedValue([]);
  vi.mocked(inventoriesApi.getInventories).mockResolvedValue([]);
  vi.mocked(termItemListingsApi.getMyTermItemListings).mockResolvedValue([]);
  vi.mocked(termItemListingsApi.getBrowseTermItemListings).mockResolvedValue([]);
  vi.mocked(itemListingPreferencesApi.getMyItemListingPreferences).mockResolvedValue([]);
  vi.mocked(groupsApi.getTermAttendeesForFormalization).mockResolvedValue([]);
  vi.mocked(groupsApi.formalizeGroupFromTerm).mockResolvedValue(groupResponse);
}

describe("useKragGrupy", () => {
  beforeEach(() => {
    setupDefaultMocks();
  });

  it("derives myAttendanceForCurrentTerm from getMyAttendances(), matching on term_id, else null", async () => {
    // No attendance at all -> null.
    const { result: withoutMatch } = renderHook(() => useKragGrupy(GROUP_ID));
    await waitFor(() => expect(withoutMatch.current.loading).toBe(false));
    expect(withoutMatch.current.myAttendanceForCurrentTerm).toBeNull();

    // An attendance row exists, but for a different term -> still null.
    vi.mocked(groupsApi.getMyAttendances).mockResolvedValue([attendance({ term_id: term.id + 1 })]);
    const { result: wrongTerm } = renderHook(() => useKragGrupy(GROUP_ID));
    await waitFor(() => expect(wrongTerm.current.loading).toBe(false));
    expect(wrongTerm.current.myAttendanceForCurrentTerm).toBeNull();

    // An attendance row matching currentTerm.id -> that row.
    const matching = attendance({ attendance_id: 77, term_id: term.id });
    vi.mocked(groupsApi.getMyAttendances).mockResolvedValue([
      attendance({ term_id: term.id + 1 }),
      matching,
    ]);
    const { result: withMatch } = renderHook(() => useKragGrupy(GROUP_ID));
    await waitFor(() => expect(withMatch.current.loading).toBe(false));
    expect(withMatch.current.myAttendanceForCurrentTerm).toEqual(matching);
  });

  it("fetches getMyTermItemListings/getBrowseTermItemListings when myAttendanceForCurrentTerm is present, or the caller is the Circle organizer", async () => {
    // Absent, non-organizer -> neither call made.
    const { result: absent } = renderHook(() => useKragGrupy(GROUP_ID));
    await waitFor(() => expect(absent.current.loading).toBe(false));
    expect(termItemListingsApi.getMyTermItemListings).not.toHaveBeenCalled();
    expect(termItemListingsApi.getBrowseTermItemListings).not.toHaveBeenCalled();

    // Present via attendance -> both called with the current term's id.
    vi.mocked(groupsApi.getMyAttendances).mockResolvedValue([attendance()]);
    const { result: present } = renderHook(() => useKragGrupy(GROUP_ID));
    await waitFor(() => expect(present.current.loading).toBe(false));
    expect(termItemListingsApi.getMyTermItemListings).toHaveBeenCalledWith(term.id);
    expect(termItemListingsApi.getBrowseTermItemListings).toHaveBeenCalledWith(term.id);
  });

  it("fetches listings for the Circle organizer even without a TermAttendance row", async () => {
    vi.mocked(groupsApi.getMyAttendances).mockResolvedValue([]);
    vi.mocked(peopleApi.getMyProfile).mockResolvedValue(myProfile({ party_id: 999 }));
    vi.mocked(groupsApi.getCurrentLeadership).mockResolvedValue(leadership({ organizer_party_id: 999 }));

    const { result } = renderHook(() => useKragGrupy(GROUP_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.myAttendanceForCurrentTerm).toBeNull();
    expect(termItemListingsApi.getMyTermItemListings).toHaveBeenCalledWith(term.id);
    expect(termItemListingsApi.getBrowseTermItemListings).toHaveBeenCalledWith(term.id);
  });

  it("takeListing() calls takeTermItemListing with the current term id, for both non-SWAP and SWAP takes", async () => {
    vi.mocked(termItemListingsApi.takeTermItemListing).mockResolvedValue({
      id: 5,
      term_id: term.id,
      item_id: 5,
      lister_party_id: 99,
      offered_types: ["LEND"],
      resolved_reservation_id: 500,
      taken_by_party_id: 42,
      product_name: "Rowerek",
      condition: "GOOD",
      lister_display_name: "Ktoś",
      created_at: "",
      updated_at: "",
    });

    const { result } = renderHook(() => useKragGrupy(GROUP_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.takeListing(1, "LEND");
    });
    expect(termItemListingsApi.takeTermItemListing).toHaveBeenLastCalledWith(1, {
      term_id: term.id,
      reservation_type: "LEND",
    });

    await act(async () => {
      await result.current.takeListing(2, "SWAP", 456);
    });
    expect(termItemListingsApi.takeTermItemListing).toHaveBeenLastCalledWith(2, {
      term_id: term.id,
      reservation_type: "SWAP",
      offered_item_id: 456,
    });
  });

  it("withdrawMyAttendance() calls the withdraw API with the current attendance id then refetches", async () => {
    const row = attendance({ attendance_id: 77 });
    vi.mocked(groupsApi.getMyAttendances).mockResolvedValue([row]);
    vi.mocked(groupsApi.withdrawMyAttendance).mockResolvedValue({
      id: 77,
      term_id: term.id,
      party_id: 42,
      child_count: 1,
      withdrawn_at: "2026-09-14T00:00:00",
    });

    const { result } = renderHook(() => useKragGrupy(GROUP_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.myAttendanceForCurrentTerm).toEqual(row);

    const callsBefore = vi.mocked(groupsApi.getMyAttendances).mock.calls.length;
    await act(async () => {
      await result.current.withdrawMyAttendance();
    });

    expect(groupsApi.withdrawMyAttendance).toHaveBeenCalledWith(77);
    // refetch() re-runs the Promise.all batch, so getMyAttendances is called again.
    expect(vi.mocked(groupsApi.getMyAttendances).mock.calls.length).toBeGreaterThan(callsBefore);
  });

  // Group 3 — Root Cause A fix: the term-page "Potwierdź odbiór" button must
  // drive confirmTransaction (term-end/race gated, SWAP-pairing aware), not
  // the raw fulfillReservation POST /fulfill the pledge-confirm flow still
  // uses (confirmPledgeReceipt, unchanged, out of scope here).
  // Group 5 — SWAP counter-offer picker fix: `mySwapAvailableItems` must
  // only surface items the caller has tagged "zamienię" (ItemListingPreference
  // mode === "SWAP"), not every AVAILABLE personal item, mirroring the
  // backend's parallel fix to `_require_own_available_personal_item`.
  // `myAvailableItems` itself stays unfiltered — it also feeds the unrelated
  // pledge-fulfil "Z moich rzeczy" picker, which isn't gated on any tag.
  it("mySwapAvailableItems includes only AVAILABLE personal items with a SWAP-tagged ItemListingPreference; myAvailableItems stays unfiltered", async () => {
    vi.mocked(peopleApi.getMyProfile).mockResolvedValue(myProfile({ account_user_id: 7 }));
    vi.mocked(inventoriesApi.getInventories).mockResolvedValue([
      { id: 55, owner_user_id: 7, inventory_type: "PERSONAL", location: null, created_at: "", updated_at: "" },
    ]);
    vi.mocked(inventoriesApi.getInventoryItems).mockResolvedValue([
      { id: 1, inventory_id: 55, home_inventory_id: null, product_id: 1, product_name: "Fotelik", condition: "GOOD", added_at: "", created_at: "", updated_at: "" },
      { id: 2, inventory_id: 55, home_inventory_id: null, product_id: 2, product_name: "Wózek", condition: "GOOD", added_at: "", created_at: "", updated_at: "" },
    ]);
    vi.mocked(inventoriesApi.getInventoryItemBalance).mockImplementation((itemId: number) =>
      Promise.resolve({ id: itemId, item_id: itemId, status: "AVAILABLE", reserved_at: null, lent_at: null, returned_at: null, due_date: null }),
    );
    vi.mocked(itemListingPreferencesApi.getMyItemListingPreferences).mockResolvedValue([
      { id: 1, item_id: 1, owner_party_id: 42, mode: "SWAP", created_at: "", updated_at: "" },
    ]);

    const { result } = renderHook(() => useKragGrupy(GROUP_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.mySwapAvailableItems).toEqual([{ id: 1, productName: "Rzecz #1" }]);
    expect(result.current.myAvailableItems).toEqual([
      { id: 1, productName: "Rzecz #1" },
      { id: 2, productName: "Rzecz #2" },
    ]);
  });

  it("mySwapAvailableItems excludes an AVAILABLE item tagged GIFT or LEND, or with no ItemListingPreference at all", async () => {
    vi.mocked(peopleApi.getMyProfile).mockResolvedValue(myProfile({ account_user_id: 7 }));
    vi.mocked(inventoriesApi.getInventories).mockResolvedValue([
      { id: 55, owner_user_id: 7, inventory_type: "PERSONAL", location: null, created_at: "", updated_at: "" },
    ]);
    vi.mocked(inventoriesApi.getInventoryItems).mockResolvedValue([
      { id: 1, inventory_id: 55, home_inventory_id: null, product_id: 1, product_name: "Fotelik", condition: "GOOD", added_at: "", created_at: "", updated_at: "" },
      { id: 2, inventory_id: 55, home_inventory_id: null, product_id: 2, product_name: "Wózek", condition: "GOOD", added_at: "", created_at: "", updated_at: "" },
      { id: 3, inventory_id: 55, home_inventory_id: null, product_id: 3, product_name: "Rowerek", condition: "GOOD", added_at: "", created_at: "", updated_at: "" },
    ]);
    vi.mocked(inventoriesApi.getInventoryItemBalance).mockImplementation((itemId: number) =>
      Promise.resolve({ id: itemId, item_id: itemId, status: "AVAILABLE", reserved_at: null, lent_at: null, returned_at: null, due_date: null }),
    );
    // item 1 -> GIFT, item 2 -> LEND, item 3 -> untagged (no preference row).
    vi.mocked(itemListingPreferencesApi.getMyItemListingPreferences).mockResolvedValue([
      { id: 1, item_id: 1, owner_party_id: 42, mode: "GIFT", created_at: "", updated_at: "" },
      { id: 2, item_id: 2, owner_party_id: 42, mode: "LEND", created_at: "", updated_at: "" },
    ]);

    const { result } = renderHook(() => useKragGrupy(GROUP_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.mySwapAvailableItems).toEqual([]);
    expect(result.current.myAvailableItems).toHaveLength(3);
  });

  it("confirmListingReceipt() calls confirmTransaction with { term_id }, never fulfillReservation", async () => {
    vi.mocked(reservationsApi.confirmTransaction).mockResolvedValue({
      reservation_id: 900,
      status: "FULFILLED",
      already_resolved: false,
    });

    const { result } = renderHook(() => useKragGrupy(GROUP_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.confirmListingReceipt(900, term.id);
    });

    expect(reservationsApi.confirmTransaction).toHaveBeenCalledWith(900, { term_id: term.id });
    expect(reservationsApi.fulfillReservation).not.toHaveBeenCalled();
  });

  // --- Group 7: API client + useKragGrupy.ts integration -----------------

  it("fetches getGroupExchangeSummary in the mount Promise.all and maps shares_item/brings_item onto the matching family's sharesItem/bringsItem", async () => {
    setupSingleFamily();
    vi.mocked(groupsApi.getGroupExchangeSummary).mockResolvedValue({
      families: [{ family_id: familyFixture.id, shares_item: true, brings_item: false }],
    });

    const { result } = renderHook(() => useKragGrupy(GROUP_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(groupsApi.getGroupExchangeSummary).toHaveBeenCalledWith(GROUP_ID);
    expect(result.current.families).toHaveLength(1);
    expect(result.current.families[0].sharesItem).toBe(true);
    expect(result.current.families[0].bringsItem).toBe(false);
  });

  it("falls back to sharesItem/bringsItem = false, without surfacing a page-level error, when getGroupExchangeSummary rejects", async () => {
    setupSingleFamily();
    vi.mocked(groupsApi.getGroupExchangeSummary).mockRejectedValue(new Error("timeout"));

    const { result } = renderHook(() => useKragGrupy(GROUP_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.families).toHaveLength(1);
    expect(result.current.families[0].sharesItem).toBe(false);
    expect(result.current.families[0].bringsItem).toBe(false);
  });

  it("loadExchangeOffersForFamily() only fetches offers when explicitly invoked, not at mount, and populates activeFamilyExchangeOffers", async () => {
    setupSingleFamily();
    const offers = [
      { id: 1, item_id: 1, product_name: "Fotelik", condition: "GOOD", offered_types: ["LEND"] },
    ];
    vi.mocked(groupsApi.getFamilyExchangeOffers).mockResolvedValue({
      family_id: familyFixture.id,
      offers,
    });

    const { result } = renderHook(() => useKragGrupy(GROUP_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(groupsApi.getFamilyExchangeOffers).not.toHaveBeenCalled();
    expect(result.current.activeFamilyExchangeOffers).toEqual([]);

    await act(async () => {
      await result.current.loadExchangeOffersForFamily(familyFixture.id);
    });

    expect(groupsApi.getFamilyExchangeOffers).toHaveBeenCalledWith(GROUP_ID, familyFixture.id);
    expect(result.current.activeFamilyExchangeOffers).toEqual(offers);
    expect(result.current.loadingExchangeOffers).toBe(false);
  });

  it("setGroupLayoutMode() applies the update optimistically, then rolls back to the previous group on a PATCH failure", async () => {
    const { result } = renderHook(() => useKragGrupy(GROUP_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.group?.layout_mode).toBe("CIRCLE");

    vi.mocked(groupsApi.updateGroupLayoutMode).mockResolvedValueOnce({
      ...groupResponse,
      layout_mode: "PITCH",
    });
    await act(async () => {
      await result.current.setGroupLayoutMode("PITCH");
    });
    expect(groupsApi.updateGroupLayoutMode).toHaveBeenCalledWith(GROUP_ID, groupResponse.name, "PITCH");
    expect(result.current.group?.layout_mode).toBe("PITCH");

    vi.mocked(groupsApi.updateGroupLayoutMode).mockRejectedValueOnce(new Error("network down"));
    await act(async () => {
      await expect(result.current.setGroupLayoutMode("TABLE")).rejects.toThrow("network down");
    });
    // Rolled back to the group value from just before this failed call
    // (still PITCH from the successful update above), not the original CIRCLE.
    expect(result.current.group?.layout_mode).toBe("PITCH");
  });

  it("extended KragFamily objects carry sharesItem/bringsItem alongside the existing familyId/name/guardians fields", async () => {
    setupSingleFamily();
    vi.mocked(groupsApi.getGroupExchangeSummary).mockResolvedValue({
      families: [{ family_id: familyFixture.id, shares_item: true, brings_item: true }],
    });

    const { result } = renderHook(() => useKragGrupy(GROUP_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.families).toEqual([
      {
        familyId: familyFixture.id,
        name: familyFixture.name,
        guardians: [guardianFixture],
        sharesItem: true,
        bringsItem: true,
      },
    ]);
  });

  // Group 5 — "Dodaj stałych członków z tego terminu" card on TermPage.
  it("fetches getTermAttendeesForFormalization for the current term once it is available", async () => {
    const rows: groupsApi.TermAttendeeResponse[] = [
      { party_id: 7, display_name: "Kasia Nowak", child_count: 1, family_id: 10, family_name: "Rodzina Nowak", already_member: false },
    ];
    vi.mocked(groupsApi.getTermAttendeesForFormalization).mockResolvedValue(rows);

    const { result } = renderHook(() => useKragGrupy(GROUP_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() =>
      expect(groupsApi.getTermAttendeesForFormalization).toHaveBeenCalledWith(GROUP_ID, term.id),
    );
    await waitFor(() => expect(result.current.termAttendeesForFormalization).toEqual(rows));
  });

  it("formalizeStandingMembers() calls formalizeGroupFromTerm(group.id, currentTerm.id, partyIds) then refetches", async () => {
    const { result } = renderHook(() => useKragGrupy(GROUP_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const callsBefore = vi.mocked(groupsApi.getGroup).mock.calls.length;
    await act(async () => {
      await result.current.formalizeStandingMembers([7, 8]);
    });

    expect(groupsApi.formalizeGroupFromTerm).toHaveBeenCalledWith(GROUP_ID, term.id, [7, 8]);
    // refetch() re-runs the mount Promise.all batch, so getGroup is called again.
    expect(vi.mocked(groupsApi.getGroup).mock.calls.length).toBeGreaterThan(callsBefore);
  });
});
