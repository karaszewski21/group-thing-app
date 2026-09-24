import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as productsApi from "../api/products";
import { useProducts } from "../hooks/useProducts";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/products", () => ({
  getProducts: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  deleteProduct: vi.fn(),
}));

describe("useProducts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(productsApi.getProducts).mockResolvedValue([]);
  });

  it("passes category_id through to getProducts()'s query params, not the retired category string", async () => {
    const { result } = renderHook(() => useProducts({ category_id: 4 }), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(productsApi.getProducts).toHaveBeenCalledTimes(1);
    const callArg = vi.mocked(productsApi.getProducts).mock.calls[0]![0];
    expect(callArg).toMatchObject({ category_id: 4 });
    expect(callArg).not.toHaveProperty("category");
  });
});
