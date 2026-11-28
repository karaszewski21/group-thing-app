import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as familiesApi from "../api/families";
import * as groupsApi from "../api/groups";
import * as inventoriesApi from "../api/inventories";
import * as organizationsApi from "../api/organizations";
import * as peopleApi from "../api/people";
import * as pledgesApi from "../api/pledges";
import * as listingApi from "../api/itemListingPreferences";
import type { MyInventoryItemResponse } from "../api/inventories";
import { AppDataProvider } from "../features/panel/AppDataContext";
import { useAppData } from "../features/panel/appDataStore";
import { createQueryWrapper } from "./queryClient";
import { routeWrapper } from "./renderWithRoute";

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ token: "tok", username: "anna", logout: vi.fn() }),
}));
vi.mock("../api/people", () => ({
  getMyProfile: vi.fn(),
  getLeadershipsForPerson: vi.fn(),
  updateMyProfile: vi.fn(),
  uploadMyAvatar: vi.fn(),
  deleteMyAvatar: vi.fn(),
}));
vi.mock("../api/families", () => ({
  getMyFamilies: vi.fn(),
  getGuardians: vi.fn(),
  getMembershipsForFamily: vi.fn(),
  createLightweightMembers: vi.fn(),
  removeFamilyMember: vi.fn(),
  renameFamily: vi.fn(),
  updateChildBirthYear: vi.fn(),
}));
vi.mock("../api/groups", () => ({
  getGroup: vi.fn(),
  getMyAttendances: vi.fn(),
  createAdditionalMyCircle: vi.fn(),
  deleteGroup: vi.fn(),
  updateGroup: vi.fn(),
}));
vi.mock("../api/inventories", () => ({
  ACTIVE_LOCK_BALANCE_STATUSES: [],
  getMyInventoryItems: vi.fn(),
  getInventoryItemBalance: vi.fn(),
  deleteInventoryItem: vi.fn(),
}));
vi.mock("../api/organizations", () => ({ getMyOrganization: vi.fn() }));
vi.mock("../api/pledges", () => ({ getMyPledges: vi.fn(), withdrawPledge: vi.fn() }));
vi.mock("../api/itemListingPreferences", () => ({ setItemListingPreference: vi.fn(), setItemFeatured: vi.fn() }));
vi.mock("../api/terms", () => ({
  createTerm: vi.fn(),
  createNeededItem: vi.fn(),
  getTerms: vi.fn(),
  getNeededItemsForTerms: vi.fn(),
}));

const ITEM: MyInventoryItemResponse = {
  id: "item-1",
  inventory_id: "inv-1",
  owner_inventory_id: "inv-1",
  product_id: "prod-1",
  product_name: "Rowerek",
  condition: "GOOD",
  listing_status: "DRAFT",
  added_at: "2026-11-01T10:00:00",
  created_at: "2026-11-01T10:00:00",
  updated_at: "2026-11-01T10:00:00",
  listing_mode: null,
  listing_visibility: null,
  points_price: null,
  is_featured: false,
  photos_moderation_pending: false,
  location_id: "loc-1",
  points_value: 40,
  balance_status: "AVAILABLE",
  reservation_id: null,
};

function renderAppData(url: string) {
  const RouteWrapper = routeWrapper({ url, wrapper: createQueryWrapper() });
  return renderHook(() => useAppData(), {
    wrapper: ({ children }) => (
      <RouteWrapper>
        <AppDataProvider>{children}</AppDataProvider>
      </RouteWrapper>
    ),
  });
}

const MY_PROFILE: peopleApi.MyProfileResponse = {
  id: "p1",
  party_id: "p1",
  account_user_id: "u1",
  display_name: "Anna",
  email: null,
  bio: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  is_organizer: false,
  page_layout: "BANNER",
  palette_preset: null,
  primary_color: null,
  accent_color: null,
  media: [],
  email_verified: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(peopleApi.getMyProfile).mockResolvedValue(MY_PROFILE);
  vi.mocked(peopleApi.getLeadershipsForPerson).mockResolvedValue([]);
  vi.mocked(inventoriesApi.getMyInventoryItems).mockResolvedValue([ITEM]);
  vi.mocked(inventoriesApi.getInventoryItemBalance).mockResolvedValue({
    id: "bal-1",
    item_id: ITEM.id,
    status: "AVAILABLE",
    reserved_at: null,
    due_date: null,
    reservation_id: null,
  });
  vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([]);
  vi.mocked(organizationsApi.getMyOrganization).mockRejectedValue(new Error("404"));
  vi.mocked(groupsApi.getMyAttendances).mockResolvedValue([]);
  vi.mocked(pledgesApi.getMyPledges).mockResolvedValue([]);
});

describe("AppDataContext — My Items mode switch", () => {
  it("setItemMode_toPoints_keepsTheSavedPriceForThePriceChip", async () => {
    vi.mocked(listingApi.setItemListingPreference).mockResolvedValue({
      id: "pref-1",
      item_id: ITEM.id,
      owner_party_id: "p1",
      mode: "POINTS",
      visibility: "PUBLIC",
      points_price: 40,
      is_featured: false,
      created_at: "2026-11-26T10:00:00",
      updated_at: "2026-11-26T10:00:00",
    });
    const { result } = renderAppData("/items");
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    await act(() => result.current.setItemMode(ITEM.id, "za punkty"));

    expect(listingApi.setItemListingPreference).toHaveBeenCalledWith(ITEM.id, "POINTS");
    expect(result.current.itemModes[ITEM.id]).toBe("za punkty");
    expect(result.current.items[0]).toMatchObject({ points_price: 40, listing_visibility: "PUBLIC" });
  });

  it("setItemMode_cleared_dropsThePrice", async () => {
    vi.mocked(inventoriesApi.getMyInventoryItems).mockResolvedValue([
      { ...ITEM, listing_mode: "POINTS", listing_status: "ACTIVE", listing_visibility: "PUBLIC", points_price: 40 },
    ]);
    vi.mocked(listingApi.setItemListingPreference).mockResolvedValue(null);
    const { result } = renderAppData("/items");
    await waitFor(() => expect(result.current.itemModes[ITEM.id]).toBe("za punkty"));

    await act(() => result.current.setItemMode(ITEM.id, "za punkty"));

    expect(listingApi.setItemListingPreference).toHaveBeenCalledWith(ITEM.id, null);
    expect(result.current.items[0]).toMatchObject({ points_price: null, listing_visibility: null });
  });
  it("setItemMode_unlistAndRelistAFeaturedItem_leavesItUnfeatured", async () => {
    vi.mocked(inventoriesApi.getMyInventoryItems).mockResolvedValue([
      { ...ITEM, listing_mode: "GIFT", listing_status: "ACTIVE", listing_visibility: "PUBLIC", is_featured: true },
    ]);
    vi.mocked(listingApi.setItemListingPreference)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "pref-2",
        item_id: ITEM.id,
        owner_party_id: "p1",
        mode: "GIFT",
        visibility: "PUBLIC",
        points_price: null,
        is_featured: false,
        created_at: "2026-11-26T10:00:00",
        updated_at: "2026-11-26T10:00:00",
      });
    const { result } = renderAppData("/items");
    await waitFor(() => expect(result.current.itemModes[ITEM.id]).toBe("oddam"));
    expect(result.current.items[0].is_featured).toBe(true);

    await act(() => result.current.setItemMode(ITEM.id, "oddam"));
    expect(result.current.itemModes[ITEM.id]).toBeNull();
    expect(result.current.items[0].is_featured).toBe(false);

    await act(() => result.current.setItemMode(ITEM.id, "oddam"));
    expect(result.current.itemModes[ITEM.id]).toBe("oddam");
    expect(result.current.items[0].is_featured).toBe(false);
  });
});
