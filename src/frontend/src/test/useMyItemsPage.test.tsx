import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as inventoriesApi from "../api/inventories";
import type { MyInventoryItemResponse, MyInventoryItemsPage, MyItemsModeFilter } from "../api/inventories";
import { ApiError } from "../api/client";
import { useMyItemsPage } from "../hooks/useMyItemsPage";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/inventories", () => ({
  getMyInventoryItemsPage: vi.fn(),
}));

function myItem(id: string): MyInventoryItemResponse {
  return {
    id,
    inventory_id: "inv-1",
    home_inventory_id: null,
    product_id: `prod-${id}`,
    product_name: `Rzecz ${id}`,
    condition: "GOOD",
    added_at: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    listing_mode: null,
    listing_visibility: null,
    listing_status: "DRAFT",
    photos_moderation_pending: false,
    location_id: "loc-1",
    balance_status: "AVAILABLE",
    reservation_id: null,
  };
}

function page(items: MyInventoryItemResponse[], pageNumber: number, total: number): MyInventoryItemsPage {
  return { items, total, page: pageNumber, size: 5, counts: { ALL: total, GIFT: 1, SWAP: 2 } };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("useMyItemsPage", () => {
  it("loads five at a time and appends the next page until the last one", async () => {
    const first = ["a", "b", "c", "d", "e"].map(myItem);
    vi.mocked(inventoriesApi.getMyInventoryItemsPage).mockImplementation(async (_filters, pageNumber) =>
      pageNumber === 1 ? page(first, 1, 6) : page([myItem("f")], 2, 6),
    );

    const { result } = renderHook(() => useMyItemsPage(null, ""), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(5);
    expect(result.current.counts).toEqual({ ALL: 6, GIFT: 1, SWAP: 2 });
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.items).toHaveLength(6));
    expect(result.current.hasNextPage).toBe(false);
    expect(inventoriesApi.getMyInventoryItemsPage).toHaveBeenNthCalledWith(1, { mode: null, q: "" }, 1, 5);
    expect(inventoriesApi.getMyInventoryItemsPage).toHaveBeenLastCalledWith({ mode: null, q: "" }, 2, 5);
  });

  it("asks again for the first page with the mode and the trimmed, debounced name", async () => {
    vi.mocked(inventoriesApi.getMyInventoryItemsPage).mockResolvedValue(page([myItem("a")], 1, 1));

    const { result, rerender } = renderHook(
      ({ mode, q }: { mode: MyItemsModeFilter | null; q: string }) => useMyItemsPage(mode, q),
      { wrapper: createQueryWrapper(), initialProps: { mode: null as MyItemsModeFilter | null, q: "" } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ mode: "GIFT", q: "  Rower " });

    await waitFor(() =>
      expect(inventoriesApi.getMyInventoryItemsPage).toHaveBeenLastCalledWith({ mode: "GIFT", q: "Rower" }, 1, 5),
    );
    expect(inventoriesApi.getMyInventoryItemsPage).not.toHaveBeenCalledWith({ mode: "GIFT", q: "  Rower " }, 1, 5);
  });

  it("keeps the loaded items and reports a failed next page separately", async () => {
    vi.mocked(inventoriesApi.getMyInventoryItemsPage)
      .mockResolvedValueOnce(page([myItem("a")], 1, 6))
      .mockRejectedValueOnce(new ApiError(500, "Internal Server Error", null));

    const { result } = renderHook(() => useMyItemsPage(null, ""), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.nextPageError).not.toBeNull());
    expect(result.current.error).toBeNull();
    expect(result.current.items.map((it) => it.id)).toEqual(["a"]);
  });
});
