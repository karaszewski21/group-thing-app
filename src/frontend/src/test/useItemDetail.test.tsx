import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as inventoriesApi from "../api/inventories";
import * as itemsApi from "../api/items";
import type { ItemDetailsResponse } from "../api/items";
import { ACCESS_DENIED_MESSAGE } from "../api/problem";
import * as productsApi from "../api/products";
import { useItemDetail, useItemEditing, useItemHistory } from "../hooks/useItemDetail";
import { createQueryWrapper, createTestQueryClient } from "./queryClient";

vi.mock("../api/items", () => ({
  getItemDetails: vi.fn(),
  getItemHistory: vi.fn(),
}));

vi.mock("../api/inventories", () => ({
  updateInventoryItem: vi.fn(),
}));

vi.mock("../api/products", () => ({
  resolveProduct: vi.fn(),
  addProductPhoto: vi.fn(),
  deleteProductPhoto: vi.fn(),
  reorderProductPhotos: vi.fn(),
  updateProductDescription: vi.fn(),
}));

const ITEM_ID = "6f1d2c3b-4a59-4e8f-9b0a-1c2d3e4f5a6b";
const PRODUCT_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const PHOTO_A = "0b6a4d0e-3c1f-4a2b-8d9e-1f2a3b4c5d6e";
const PHOTO_B = "1c7b5e1f-4d2a-4b3c-9e0f-2a3b4c5d6e7f";
const PHOTO_C = "2d8c6f2a-5e3b-4c4d-8f1a-3b4c5d6e7f8a";

const item: ItemDetailsResponse = {
  id: ITEM_ID,
  product_id: PRODUCT_ID,
  name: "Rower biegowy",
  category_id: "3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b",
  category_name: "Pojazdy",
  condition: "GOOD",
  description: null,
  photos: [
    { id: PHOTO_A, url: "https://cdn.example/a/w1600.webp", thumb_url: "https://cdn.example/a/w400.webp", status: "APPROVED", sort_order: 0 },
    { id: PHOTO_B, url: "https://cdn.example/b/w1600.webp", thumb_url: "https://cdn.example/b/w400.webp", status: "APPROVED", sort_order: 1 },
    { id: PHOTO_C, url: "https://cdn.example/c/w1600.webp", thumb_url: "https://cdn.example/c/w400.webp", status: "APPROVED", sort_order: 2 },
  ],
  product_photo_url: null,
  is_owner: true,
  deleted_at: null,
  status: { code: "AVAILABLE", term_occurs_on: null, due_date: null, counterparty_label: null },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Wired like ItemEditPage: the editing hook sees the details query state. */
function renderPageHooks() {
  return renderHook(
    () => {
      const detail = useItemDetail(ITEM_ID);
      const editing = useItemEditing(ITEM_ID, {
        productId: detail.item?.product_id ?? PRODUCT_ID,
        fetching: detail.fetching,
        failed: detail.error !== null,
      });
      return { detail, editing };
    },
    { wrapper: createQueryWrapper() },
  );
}

describe("useItemDetail", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns the item, and reports notFound for 404 and for 400 (malformed id)", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValueOnce(item);
    const ok = renderHook(() => useItemDetail(ITEM_ID), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(ok.result.current.loading).toBe(false));
    expect(ok.result.current.item).toEqual(item);
    expect(ok.result.current.notFound).toBe(false);
    expect(ok.result.current.error).toBeNull();
    expect(itemsApi.getItemDetails).toHaveBeenCalledWith(ITEM_ID);

    for (const status of [404, 400]) {
      vi.mocked(itemsApi.getItemDetails).mockRejectedValueOnce(
        new ApiError(status, "Err", { message: "Nie znaleziono" }),
      );
      const failed = renderHook(() => useItemDetail(ITEM_ID), { wrapper: createQueryWrapper() });
      await waitFor(() => expect(failed.result.current.loading).toBe(false));
      expect(failed.result.current.notFound).toBe(true);
      expect(failed.result.current.error).toBeNull();
      expect(failed.result.current.item).toBeNull();
    }
  });

  it("reports any other failure as the extractProblemMessage text with a null item", async () => {
    vi.mocked(itemsApi.getItemDetails).mockRejectedValue(
      new ApiError(500, "Internal Server Error", { message: "Coś poszło nie tak" }),
    );
    const { result } = renderHook(() => useItemDetail(ITEM_ID), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Coś poszło nie tak");
    expect(result.current.notFound).toBe(false);
    expect(result.current.item).toBeNull();
  });

  it("isolates a history failure: details still load, history falls back to a stable empty list", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(item);
    vi.mocked(itemsApi.getItemHistory).mockRejectedValue(
      new ApiError(500, "Internal Server Error", { message: "Historia niedostępna" }),
    );
    const { result, rerender } = renderHook(
      () => ({ detail: useItemDetail(ITEM_ID), history: useItemHistory(ITEM_ID) }),
      { wrapper: createQueryWrapper() },
    );
    await waitFor(() => expect(result.current.history.loading).toBe(false));
    await waitFor(() => expect(result.current.detail.loading).toBe(false));

    expect(result.current.detail.item).toEqual(item);
    expect(result.current.detail.error).toBeNull();
    expect(result.current.history.error).toBe("Historia niedostępna");
    expect(result.current.history.data).toEqual([]);
    const fallback = result.current.history.data;
    rerender();
    expect(result.current.history.data).toBe(fallback);
  });
});

describe("useItemDetail pending-photo polling", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const pendingPhoto = { ...item.photos[0], status: "PENDING" as const };

  /** The interval TanStack would use next, read from the live query's
   * observer options (no 10 s wall-clock wait). */
  function nextInterval(client: ReturnType<typeof createTestQueryClient>) {
    const query = client.getQueryCache().find({ queryKey: ["itemDetails", ITEM_ID] });
    const option = query?.observers[0]?.options.refetchInterval;
    return typeof option === "function" ? option(query!) : option;
  }

  it("ownerWithPendingPhoto_refetchesEvery10s, and stops once no photo is PENDING", async () => {
    vi.mocked(itemsApi.getItemDetails)
      .mockResolvedValueOnce({ ...item, photos: [pendingPhoto, ...item.photos.slice(1)] })
      .mockResolvedValue(item);
    const client = createTestQueryClient();
    const { result } = renderHook(() => useItemDetail(ITEM_ID), { wrapper: createQueryWrapper(client) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(nextInterval(client)).toBe(10_000);
    const observer = client.getQueryCache().find({ queryKey: ["itemDetails", ITEM_ID] })?.observers[0];
    expect(observer?.options.refetchIntervalInBackground).toBeFalsy();

    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.item?.photos.every((p) => p.status === "APPROVED")).toBe(true);
    expect(nextInterval(client)).toBe(false);
  });

  it("nonOwnerOrNoPendingPhoto_doesNotPoll", async () => {
    for (const details of [
      { ...item, is_owner: false, photos: [pendingPhoto] },
      { ...item, photos: [{ ...pendingPhoto, status: "NEEDS_REVIEW" as const }] },
      item,
    ]) {
      vi.mocked(itemsApi.getItemDetails).mockResolvedValueOnce(details);
      const client = createTestQueryClient();
      const { result, unmount } = renderHook(() => useItemDetail(ITEM_ID), {
        wrapper: createQueryWrapper(client),
      });
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(nextInterval(client)).toBe(false);
      unmount();
    }
  });
});

describe("useItemEditing", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(item);
  });

  it("movePhoto swaps the ids, holds photoBusy until the details refetch settles, on success and on 409", async () => {
    const { result } = renderPageHooks();
    await waitFor(() => expect(result.current.detail.item).not.toBeNull());
    expect(result.current.editing.photoBusy).toBe(false);

    const ok = deferred<productsApi.ProductPhotoResponse[]>();
    vi.mocked(productsApi.reorderProductPhotos).mockReturnValueOnce(ok.promise);
    let moving!: Promise<void>;
    act(() => {
      moving = result.current.editing.movePhoto(PHOTO_A, "down");
    });
    expect(productsApi.reorderProductPhotos).toHaveBeenCalledWith(PRODUCT_ID, [PHOTO_B, PHOTO_A, PHOTO_C]);
    await waitFor(() => expect(result.current.editing.photoBusy).toBe(true));

    await act(async () => {
      ok.resolve([]);
      await moving;
    });
    expect(result.current.editing.photoBusy).toBe(false);
    expect(itemsApi.getItemDetails).toHaveBeenCalledTimes(2);

    const conflict = deferred<productsApi.ProductPhotoResponse[]>();
    vi.mocked(productsApi.reorderProductPhotos).mockReturnValueOnce(conflict.promise);
    let failing!: Promise<void>;
    act(() => {
      failing = result.current.editing.movePhoto(PHOTO_C, "up");
    });
    expect(productsApi.reorderProductPhotos).toHaveBeenLastCalledWith(PRODUCT_ID, [PHOTO_A, PHOTO_C, PHOTO_B]);
    await waitFor(() => expect(result.current.editing.photoBusy).toBe(true));

    await act(async () => {
      conflict.reject(
        new ApiError(409, "Conflict", {
          message: "Lista zdjęć jest nieaktualna — odśwież stronę",
        }),
      );
      await expect(failing).rejects.toThrow("Lista zdjęć jest nieaktualna — odśwież stronę");
    });
    expect(result.current.editing.photoBusy).toBe(false);
    expect(itemsApi.getItemDetails).toHaveBeenCalledTimes(3);
  });

  it("saveNameCategory resolves the product then re-points the item; a 403 rejects with ACCESS_DENIED_MESSAGE", async () => {
    const resolvedId = "7c6d5e4f-3a2b-4c1d-9e8f-7a6b5c4d3e2f";
    vi.mocked(productsApi.resolveProduct).mockResolvedValue({
      id: resolvedId,
    } as unknown as productsApi.ProductResponse);
    vi.mocked(inventoriesApi.updateInventoryItem).mockResolvedValueOnce(
      {} as inventoriesApi.InventoryItemResponse,
    );
    const { result } = renderPageHooks();
    await waitFor(() => expect(result.current.detail.item).not.toBeNull());

    await act(async () => {
      await result.current.editing.saveNameCategory("Hulajnoga", item.category_id);
    });
    expect(productsApi.resolveProduct).toHaveBeenCalledWith({
      name: "Hulajnoga",
      category_id: item.category_id,
    });
    expect(inventoriesApi.updateInventoryItem).toHaveBeenCalledWith(ITEM_ID, {
      product_id: resolvedId,
    });

    vi.mocked(inventoriesApi.updateInventoryItem).mockRejectedValueOnce(
      new ApiError(403, "Forbidden", { message: "Access denied" }),
    );
    await act(async () => {
      await expect(
        result.current.editing.saveNameCategory("Hulajnoga", item.category_id),
      ).rejects.toThrow(ACCESS_DENIED_MESSAGE);
    });
  });

  it("a re-point followed by a failed refetch blocks product writes instead of hitting the old product", async () => {
    const newProductId = "7c6d5e4f-3a2b-4c1d-9e8f-7a6b5c4d3e2f";
    vi.mocked(productsApi.resolveProduct).mockResolvedValue({
      id: newProductId,
    } as unknown as productsApi.ProductResponse);
    vi.mocked(inventoriesApi.updateInventoryItem).mockResolvedValue(
      {} as inventoriesApi.InventoryItemResponse,
    );
    const { result } = renderPageHooks();
    await waitFor(() => expect(result.current.editing.productEditable).toBe(true));

    vi.mocked(itemsApi.getItemDetails).mockRejectedValue(
      new ApiError(500, "Internal Server Error", { message: "Błąd serwera" }),
    );
    await act(async () => {
      await result.current.editing.saveNameCategory("Hulajnoga", item.category_id);
    });
    await waitFor(() => expect(result.current.detail.error).toBe("Błąd serwera"));
    expect(result.current.detail.item?.product_id).toBe(PRODUCT_ID);
    expect(result.current.editing.productEditable).toBe(false);

    await act(async () => {
      await expect(result.current.editing.saveDescription("Nowy opis")).rejects.toThrow(
        /Dane produktu są nieaktualne/,
      );
      await expect(result.current.editing.addPhoto(new File(["d"], "d.jpg", { type: "image/jpeg" }))).rejects.toThrow(
        /Dane produktu są nieaktualne/,
      );
      await expect(result.current.editing.removePhoto(PHOTO_A)).rejects.toThrow(
        /Dane produktu są nieaktualne/,
      );
    });
    expect(productsApi.updateProductDescription).not.toHaveBeenCalled();
    expect(productsApi.addProductPhoto).not.toHaveBeenCalled();
    expect(productsApi.deleteProductPhoto).not.toHaveBeenCalled();

    // A successful retry brings the new product; writes then go to it.
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue({ ...item, product_id: newProductId });
    await act(async () => {
      await result.current.detail.refetch();
    });
    await waitFor(() => expect(result.current.editing.productEditable).toBe(true));
    vi.mocked(productsApi.updateProductDescription).mockResolvedValueOnce({ description: "Nowy opis" });
    await act(async () => {
      await result.current.editing.saveDescription("Nowy opis");
    });
    expect(productsApi.updateProductDescription).toHaveBeenCalledWith(newProductId, "Nowy opis");
  });

  it("a 403 from a product photo or description write rejects with ACCESS_DENIED_MESSAGE", async () => {
    const forbidden = new ApiError(403, "Forbidden", { message: "Access denied" });
    vi.mocked(productsApi.updateProductDescription).mockRejectedValueOnce(forbidden);
    vi.mocked(productsApi.addProductPhoto).mockRejectedValueOnce(forbidden);
    const { result } = renderPageHooks();
    await waitFor(() => expect(result.current.editing.productEditable).toBe(true));

    await act(async () => {
      await expect(result.current.editing.saveDescription("Opis")).rejects.toThrow(
        ACCESS_DENIED_MESSAGE,
      );
      await expect(result.current.editing.addPhoto(new File(["d"], "d.jpg", { type: "image/jpeg" }))).rejects.toThrow(
        ACCESS_DENIED_MESSAGE,
      );
    });
    expect(productsApi.updateProductDescription).toHaveBeenCalledWith(PRODUCT_ID, "Opis");
  });
});
