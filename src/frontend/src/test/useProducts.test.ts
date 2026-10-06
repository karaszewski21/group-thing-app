import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as productsApi from "../api/products";
import { useProducts } from "../hooks/useProducts";
import { pageOf } from "./page";
import { createQueryWrapper } from "./queryClient";

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
});
