import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useItemTake, type TakeContext } from "../pages/product/useItemTake";
import * as itemReservationsApi from "../api/itemReservations";
import * as inventoriesApi from "../api/inventories";
import type { InventoryBalanceResponse, MyInventoryItemResponse } from "../api/inventories";
import type { ItemTakeResponse } from "../api/itemReservations";
import type { SwapProposalResponse } from "../api/termItemListings";
import { EVENT_KEY } from "../hooks/useEvent";
import { ITEM_ACTIONS_KEY } from "../hooks/useItemActions";
import { ITEM_DETAILS_KEY } from "../hooks/useItemDetail";
import { ORGANIZER_PAGE_KEY } from "../hooks/useOrganizerPage";
import { OWNER_ITEMS_KEY } from "../hooks/useOwnerItems";
import { createQueryWrapper, createTestQueryClient } from "./queryClient";

vi.mock("../api/itemReservations", () => ({ takeItem: vi.fn(), proposeItemSwap: vi.fn() }));
vi.mock("../api/inventories", () => ({ getMyInventoryItems: vi.fn(), getInventoryItemBalance: vi.fn() }));

const TERM: TakeContext = {
  kind: "TERM",
  id: "t1",
  name: "Muzyczne Skrzaty",
  starts_at: "2026-11-05T17:00:00",
  path: "/ania/group/g1/term/t1",
};

const personalTake: ItemTakeResponse = { item_id: "i1", product_name: "Kurtka", context: null };

const termTake: ItemTakeResponse = {
  item_id: "i1",
  product_name: "Kurtka",
  context: { ...TERM, has_started: false },
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
  listing_visibility: "PUBLIC",
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

function renderTake({ isLoggedIn = true, client = createTestQueryClient() } = {}) {
  const deps = {
    isLoggedIn,
    refetch: vi.fn().mockResolvedValue(undefined),
    showToast: vi.fn(),
    onReserved: vi.fn(),
  };
  const view = renderHook(() => useItemTake(deps), { wrapper: createQueryWrapper(client) });
  return { ...view, deps };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(inventoriesApi.getMyInventoryItems).mockResolvedValue([mySwapItem]);
  vi.mocked(inventoriesApi.getInventoryItemBalance).mockResolvedValue(available);
});

describe("useItemTake", () => {
  it("a personal GIFT takes with the PERSONAL context, toasts and reports it via onReserved, without a success sheet", async () => {
    vi.mocked(itemReservationsApi.takeItem).mockResolvedValue(personalTake);
    const { result, deps } = renderTake();

    act(() => result.current.take("i1", "GIFT", { kind: "PERSONAL" }));

    await waitFor(() => expect(deps.onReserved).toHaveBeenCalledWith({ kind: "PERSONAL" }));
    expect(itemReservationsApi.takeItem).toHaveBeenCalledWith("i1", {
      context: { kind: "PERSONAL" },
      reservation_type: "GIFT",
    });
    expect(deps.showToast).toHaveBeenCalledWith("Zarezerwowano!");
    expect(result.current.takeSuccess).toBeNull();
  });

  it("a failed take does not call onReserved", async () => {
    vi.mocked(itemReservationsApi.takeItem).mockRejectedValue(new Error("boom"));
    const { result, deps } = renderTake();

    act(() => result.current.take("i1", "GIFT", { kind: "PERSONAL" }));

    await waitFor(() => expect(deps.showToast).toHaveBeenCalled());
    expect(deps.onReserved).not.toHaveBeenCalled();
  });

  it("a TERM target sends the term's kind and id", async () => {
    vi.mocked(itemReservationsApi.takeItem).mockResolvedValue(termTake);
    const { result, deps } = renderTake();

    act(() => result.current.take("i1", "GIFT", TERM));

    await waitFor(() => expect(result.current.takeSuccess).not.toBeNull());
    expect(itemReservationsApi.takeItem).toHaveBeenCalledWith("i1", {
      context: { kind: "TERM", id: "t1" },
      reservation_type: "GIFT",
    });
    expect(result.current.takeSuccess).toEqual({ itemId: "i1", itemName: "Kurtka", target: TERM });
    expect(deps.onReserved).toHaveBeenCalledWith(TERM);
  });

  it("SWAP opens the picker, then proposes with the chosen item and the context", async () => {
    vi.mocked(itemReservationsApi.proposeItemSwap).mockResolvedValue(proposal);
    const { result, deps } = renderTake();

    act(() => result.current.take("i1", "SWAP", TERM));
    await waitFor(() => expect(result.current.swap.itemId).toBe("i1"));
    expect(deps.onReserved).not.toHaveBeenCalled();
    expect(result.current.swap.availableItems).toEqual([{ id: "m1", productName: "Blender", condition: "GOOD" }]);
    expect(itemReservationsApi.proposeItemSwap).not.toHaveBeenCalled();

    act(() => result.current.swap.confirm("i1"));

    await waitFor(() =>
      expect(itemReservationsApi.proposeItemSwap).toHaveBeenCalledWith("i1", {
        context: { kind: "TERM", id: "t1" },
        offered_item_id: "m1",
      }),
    );
    await waitFor(() => expect(deps.showToast).toHaveBeenCalledWith("Zaproponowano zamianę! Szczegóły w Twoim panelu"));
    expect(result.current.swap.itemId).toBeNull();
    expect(deps.onReserved).toHaveBeenCalledWith(TERM);
    expect(itemReservationsApi.takeItem).not.toHaveBeenCalled();
  });

  it("awaits invalidation of every affected prefix before refetching", async () => {
    vi.mocked(itemReservationsApi.takeItem).mockResolvedValue(personalTake);
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result, deps } = renderTake({ client });

    act(() => result.current.take("i1", "GIFT", { kind: "PERSONAL" }));

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
        ["groupAccess"],
      ]),
    );
    expect(Math.max(...invalidate.mock.invocationCallOrder)).toBeLessThan(deps.refetch.mock.invocationCallOrder[0]);
  });

  it("an anonymous caller hits the account gate instead of taking", async () => {
    const { result } = renderTake({ isLoggedIn: false });

    act(() => result.current.take("i1", "GIFT", { kind: "PERSONAL" }));

    await waitFor(() => expect(result.current.gateOpen).toBe(true));
    expect(itemReservationsApi.takeItem).not.toHaveBeenCalled();
  });
});
