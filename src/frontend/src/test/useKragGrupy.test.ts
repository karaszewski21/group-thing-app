import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as groupsApi from "../api/groups";
import * as inventoriesApi from "../api/inventories";
import * as peopleApi from "../api/people";
import * as pledgesApi from "../api/pledges";
import * as productsApi from "../api/products";
import * as termItemListingsApi from "../api/termItemListings";
import * as termsApi from "../api/terms";
import { useKragGrupy } from "../hooks/useKragGrupy";

vi.mock("../api/families", () => ({
  getFamiliesForGuardianParty: vi.fn(),
  getGuardians: vi.fn(),
}));

vi.mock("../api/groups", () => ({
  getCurrentLeadership: vi.fn(),
  getGroup: vi.fn(),
  getMembershipsForCircle: vi.fn(),
  getMyAttendances: vi.fn(),
  withdrawMyAttendance: vi.fn(),
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

const GROUP_ID = 1;

const term = {
  id: 100,
  circle_group_id: GROUP_ID,
  occurs_on: "2026-10-01T17:00:00",
  description: null,
  created_at: "2026-01-01T00:00:00",
  updated_at: "2026-01-01T00:00:00",
};

const groupResponse = {
  id: GROUP_ID,
  party_id: 5,
  name: "Test Circle",
  organizer_slug: "test-circle",
  created_at: "2026-01-01T00:00:00",
  updated_at: "2026-01-01T00:00:00",
};

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
  vi.mocked(termsApi.getTerms).mockResolvedValue([term]);
  vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
  vi.mocked(peopleApi.getMyProfile).mockResolvedValue(myProfile());
  vi.mocked(peopleApi.getProfileByParty).mockResolvedValue(myProfile({ party_id: 999 }));
  vi.mocked(productsApi.getProducts).mockResolvedValue([]);
  vi.mocked(pledgesApi.getPledges).mockResolvedValue([]);
  vi.mocked(inventoriesApi.getInventories).mockResolvedValue([]);
  vi.mocked(termItemListingsApi.getMyTermItemListings).mockResolvedValue([]);
  vi.mocked(termItemListingsApi.getBrowseTermItemListings).mockResolvedValue([]);
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
});
