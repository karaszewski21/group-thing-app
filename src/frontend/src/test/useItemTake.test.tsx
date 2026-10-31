import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useItemTake, type TakeContext } from "../pages/term/hooks/useItemTake";
import * as eventItemsApi from "../api/eventItems";
import * as termItemListingsApi from "../api/termItemListings";
import * as inventoriesApi from "../api/inventories";
import type { InventoryBalanceResponse, MyInventoryItemResponse } from "../api/inventories";
import type { EventTakeResponse } from "../api/eventItems";
import type { BrowseTermItemListingResponse, SwapProposalResponse } from "../api/termItemListings";
import { EVENT_KEY } from "../hooks/useEvent";
import { ITEM_ACTIONS_KEY } from "../hooks/useItemActions";
import { ITEM_DETAILS_KEY } from "../hooks/useItemDetail";
import { ORGANIZER_PAGE_KEY } from "../hooks/useOrganizerPage";
import { OWNER_ITEMS_KEY } from "../hooks/useOwnerItems";
import { createQueryWrapper, createTestQueryClient } from "./queryClient";

vi.mock("../api/eventItems", () => ({ takeEventItem: vi.fn(), proposeEventSwap: vi.fn() }));
vi.mock("../api/termItemListings", () => ({ takeTermItemListing: vi.fn(), proposeSwap: vi.fn() }));
vi.mock("../api/inventories", () => ({ getMyInventoryItems: vi.fn(), getInventoryItemBalance: vi.fn() }));

const EVENT: TakeContext = {
  kind: "event",
  id: "e1",
  name: "Wymianka sąsiedzka",
  starts_at: "2026-11-08T10:00:00",
  path: "/ania/event/e1",
};

const TERM: TakeContext = {
  kind: "term",
  id: "t1",
  name: "Muzyczne Skrzaty",
  starts_at: "2026-11-05T17:00:00",
  path: "/ania/group/g1/term/t1",
};

const eventTake: EventTakeResponse = {
  item_id: "i1",
  product_name: "Kurtka",
  context: {
    kind: "EVENT",
    id: "e1",
    name: "Wymianka sąsiedzka",
    starts_at: "2026-11-08T10:00:00",
    path: "/ania/event/e1",
    has_started: false,
  },
};

const termTake: BrowseTermItemListingResponse = {
  id: "i1",
  term_id: "t1",
  item_id: "i1",
  lister_party_id: "p1",
  offered_types: ["GIFT"],
  resolved_reservation_id: "r1",
  taken_by_party_id: "p2",
  product_name: "Kurtka",
  condition: "GOOD",
  lister_display_name: "Bartek",
  created_at: "2026-10-01T10:00:00",
  updated_at: "2026-10-01T10:00:00",
};

const proposal: SwapProposalResponse = {
  id: "s1",
  proposer_party_id: "p2",
  listing_item_id: "i1",
  offered_item_id: "m1",
  proposer_reservation_id: "r2",
  status: "PROPOSED",
  created_at: "2026-10-01T10:00:00",
  updated_at: "2026-10-01T10:00:00",
};

const mySwapItem: MyInventoryItemResponse = {
  id: "m1",
  inventory_id: "inv",
  home_inventory_id: null,
  product_id: "pr1",
  product_name: "Blender",
  condition: "GOOD",
  listing_status: "ACTIVE",
  added_at: "2026-10-01T10:00:00",
  created_at: "2026-10-01T10:00:00",
  updated_at: "2026-10-01T10:00:00",
  listing_mode: "SWAP",
  photos_moderation_pending: false,
};

const available: InventoryBalanceResponse = {
  id: "b1",
  item_id: "m1",
  status: "AVAILABLE",
  reserved_at: null,
  lent_at: null,
  returned_at: null,
  due_date: null,
  reservation_id: null,
};

function renderTake(context: TakeContext | null, client = createTestQueryClient()) {
  const deps = { isLoggedIn: true, refetch: vi.fn().mockResolvedValue(undefined), showToast: vi.fn() };
  const view = renderHook(() => useItemTake({ ...deps, context }), { wrapper: createQueryWrapper(client) });
  return { ...view, deps };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(inventoriesApi.getMyInventoryItems).mockResolvedValue([mySwapItem]);
  vi.mocked(inventoriesApi.getInventoryItemBalance).mockResolvedValue(available);
});

describe("useItemTake", () => {
  it("event context: GIFT take calls takeEventItem and exposes the event as the success context", async () => {
    vi.mocked(eventItemsApi.takeEventItem).mockResolvedValue(eventTake);
    const { result } = renderTake(EVENT);

    act(() => result.current.take("i1", "GIFT"));

    await waitFor(() => expect(result.current.takeSuccess).not.toBeNull());
    expect(eventItemsApi.takeEventItem).toHaveBeenCalledWith("e1", "i1", "GIFT");
    expect(termItemListingsApi.takeTermItemListing).not.toHaveBeenCalled();
    expect(result.current.takeSuccess).toEqual({ itemId: "i1", itemName: "Kurtka", context: EVENT });
  });

  it("event context: SWAP opens the picker with condition and proposes via proposeEventSwap", async () => {
    vi.mocked(eventItemsApi.proposeEventSwap).mockResolvedValue(proposal);
    const { result, deps } = renderTake(EVENT);

    act(() => result.current.take("i1", "SWAP"));
    await waitFor(() => expect(result.current.swap.itemId).toBe("i1"));
    expect(result.current.swap.availableItems).toEqual([{ id: "m1", productName: "Blender", condition: "GOOD" }]);
    expect(eventItemsApi.proposeEventSwap).not.toHaveBeenCalled();

    act(() => result.current.swap.confirm("i1"));

    await waitFor(() => expect(eventItemsApi.proposeEventSwap).toHaveBeenCalledWith("e1", "i1", "m1"));
    expect(termItemListingsApi.proposeSwap).not.toHaveBeenCalled();
    await waitFor(() => expect(deps.showToast).toHaveBeenCalledWith("Zaproponowano zamianę! Szczegóły w Twoim panelu"));
    expect(result.current.swap.itemId).toBeNull();
  });

  it("term context still calls the term take and propose endpoints", async () => {
    vi.mocked(termItemListingsApi.takeTermItemListing).mockResolvedValue(termTake);
    vi.mocked(termItemListingsApi.proposeSwap).mockResolvedValue(proposal);
    const { result } = renderTake(TERM);

    act(() => result.current.take("i1", "GIFT"));
    await waitFor(() => expect(result.current.takeSuccess).not.toBeNull());
    expect(termItemListingsApi.takeTermItemListing).toHaveBeenCalledWith("i1", { term_id: "t1", reservation_type: "GIFT" });
    expect(result.current.takeSuccess).toEqual({ itemId: "i1", itemName: "Kurtka", context: TERM });

    act(() => result.current.take("i2", "SWAP"));
    await waitFor(() => expect(result.current.swap.itemId).toBe("i2"));
    act(() => result.current.swap.confirm("i2"));
    await waitFor(() =>
      expect(termItemListingsApi.proposeSwap).toHaveBeenCalledWith("i2", { term_id: "t1", offered_item_id: "m1" }),
    );
    expect(eventItemsApi.takeEventItem).not.toHaveBeenCalled();
    expect(eventItemsApi.proposeEventSwap).not.toHaveBeenCalled();
  });

  it("awaits invalidation of the item, owner-items, event, organizer-page and notifications prefixes before refetching", async () => {
    vi.mocked(eventItemsApi.takeEventItem).mockResolvedValue(eventTake);
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result, deps } = renderTake(EVENT, client);

    act(() => result.current.take("i1", "GIFT"));

    await waitFor(() => expect(deps.refetch).toHaveBeenCalled());
    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        [ITEM_ACTIONS_KEY],
        [ITEM_DETAILS_KEY],
        [OWNER_ITEMS_KEY],
        [EVENT_KEY],
        [ORGANIZER_PAGE_KEY],
        ["notifications"],
      ]),
    );
    expect(Math.max(...invalidate.mock.invocationCallOrder)).toBeLessThan(deps.refetch.mock.invocationCallOrder[0]);
  });

  it("without a context a take does nothing", async () => {
    const { result } = renderTake(null);

    act(() => result.current.take("i1", "GIFT"));

    await waitFor(() => expect(result.current.busyItemId).toBeNull());
    expect(eventItemsApi.takeEventItem).not.toHaveBeenCalled();
    expect(termItemListingsApi.takeTermItemListing).not.toHaveBeenCalled();
  });
});
