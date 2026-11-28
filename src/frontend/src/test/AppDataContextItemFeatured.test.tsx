import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as familiesApi from "../api/families";
import * as groupsApi from "../api/groups";
import * as inventoriesApi from "../api/inventories";
import * as organizationsApi from "../api/organizations";
import * as peopleApi from "../api/people";
import * as pledgesApi from "../api/pledges";
import * as listingApi from "../api/itemListingPreferences";
import { ApiError } from "../api/client";
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
  listing_status: "ACTIVE",
  added_at: "2026-11-01T10:00:00",
  created_at: "2026-11-01T10:00:00",
  updated_at: "2026-11-01T10:00:00",
  listing_mode: "GIFT",
  listing_visibility: "PUBLIC",
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

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(peopleApi.getMyProfile).mockResolvedValue({ id: "p1", display_name: "Anna", bio: null } as peopleApi.UserProfileResponse);
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

const SAVED: listingApi.ItemListingPreferenceResponse = {
  id: "pref-1",
  item_id: ITEM.id,
  owner_party_id: "p1",
  mode: "GIFT",
  visibility: "PUBLIC",
  points_price: null,
  is_featured: true,
  created_at: "2026-11-26T10:00:00",
  updated_at: "2026-11-26T10:00:00",
};

describe("AppDataContext — featuring an item", () => {
  it("setItemFeatured_success_marksTheItemFeatured", async () => {
    vi.mocked(listingApi.setItemFeatured).mockResolvedValue(SAVED);
    const { result } = renderAppData("/items");
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    await act(() => result.current.setItemFeatured(ITEM.id, true));

    expect(listingApi.setItemFeatured).toHaveBeenCalledWith(ITEM.id, true);
    expect(result.current.items[0].is_featured).toBe(true);
    expect(result.current.toast).toBe("");
  });

  it("setItemFeatured_conflict_toastsTheServerMessageAndRefreshesTheItems", async () => {
    vi.mocked(listingApi.setItemFeatured).mockRejectedValue(
      new ApiError(409, "Conflict", { message: "Możesz wyróżnić maksymalnie 3 rzeczy." }),
    );
    const { result } = renderAppData("/items");
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    const readsBefore = vi.mocked(inventoriesApi.getMyInventoryItems).mock.calls.length;

    await act(() => result.current.setItemFeatured(ITEM.id, true));

    expect(result.current.toast).toBe("Możesz wyróżnić maksymalnie 3 rzeczy.");
    await waitFor(() =>
      expect(vi.mocked(inventoriesApi.getMyInventoryItems).mock.calls.length).toBeGreaterThan(readsBefore),
    );
    expect(result.current.items[0].is_featured).toBe(false);
  });

  it("setItemFeatured_unknownError_toastsTheFallback", async () => {
    vi.mocked(listingApi.setItemFeatured).mockRejectedValue(new Error("network"));
    const { result } = renderAppData("/items");
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    await act(() => result.current.setItemFeatured(ITEM.id, true));

    expect(result.current.toast).toBe("Nie udało się zapisać wyróżnienia — spróbuj ponownie");
  });
});
