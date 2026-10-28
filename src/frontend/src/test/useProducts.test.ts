import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as productsApi from "../api/products";
import { useProducts } from "../hooks/useProducts";
import { pageOf } from "./page";
import { createQueryWrapper, createTestQueryClient } from "./queryClient";

vi.mock("../api/products", () => ({
  getProductsPage: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  deleteProduct: vi.fn(),
}));

describe("useProducts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(productsApi.getProductsPage).mockResolvedValue(pageOf([]));
  });

  it("passes category_id and the page through to getProductsPage(), not the retired category string", async () => {
    const { result } = renderHook(() => useProducts({ category_id: "4", page: 2 }), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(productsApi.getProductsPage).toHaveBeenCalledTimes(1);
    const [callArg, page] = vi.mocked(productsApi.getProductsPage).mock.calls[0]!;
    expect(page).toBe(2);
    expect(callArg).toMatchObject({ category_id: "4" });
    expect(callArg).not.toHaveProperty("category");
  });

  it("remove(id) invalidates the categories prefix too, since product_count changes", async () => {
    vi.mocked(productsApi.deleteProduct).mockResolvedValue(undefined);
    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useProducts({ page: 0 }), { wrapper: createQueryWrapper(client) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.remove("p1");

    expect(productsApi.deleteProduct).toHaveBeenCalledWith("p1");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["products"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["categories"] });
  });
});
