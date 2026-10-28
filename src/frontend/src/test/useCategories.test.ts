import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as categoriesApi from "../api/categories";
import type { Category } from "../api/categories";
import { useCategories } from "../hooks/useCategories";
import { createQueryWrapper, createTestQueryClient } from "./queryClient";

vi.mock("../api/categories", () => ({
  getCategories: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
  moveCategory: vi.fn(),
}));

const mockCategories: Category[] = [
  {
    id: "1",
    name: "Zabawki",
    description: null,
    parent_id: null,
    sort_order: 0,
    product_count: 3,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "2",
    name: "Książki",
    description: null,
    parent_id: null,
    sort_order: 1,
    product_count: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
];

describe("useCategories", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("fetches and returns categories ordered by sort_order", async () => {
    vi.mocked(categoriesApi.getCategories).mockResolvedValue(mockCategories);

    const { result } = renderHook(() => useCategories(), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(mockCategories);
    expect(result.current.data.map((c) => c.sort_order)).toEqual([0, 1]);
    expect(result.current.error).toBeNull();
  });

  it("remove(id) propagates the backend ApiError's detail message on 409, not a generic string", async () => {
    vi.mocked(categoriesApi.getCategories).mockResolvedValue(mockCategories);
    vi.mocked(categoriesApi.deleteCategory).mockRejectedValue(
      new ApiError(409, "Conflict", {
        status: 409,
        error: "Conflict",
        message: "Category with id 1 cannot be deleted because it has 3 associated product(s)",
      }),
    );

    const { result } = renderHook(() => useCategories(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.remove("1")).rejects.toThrow(
      "Category with id 1 cannot be deleted because it has 3 associated product(s)",
    );
  });

  it("create() and update() refetch the cached list despite the 5-minute staleTime", async () => {
    vi.mocked(categoriesApi.getCategories).mockResolvedValue(mockCategories);
    vi.mocked(categoriesApi.createCategory).mockResolvedValue({ ...mockCategories[0]!, id: "3", name: "Dom" });
    vi.mocked(categoriesApi.updateCategory).mockResolvedValue({ ...mockCategories[1]!, name: "Komiksy" });

    const { result } = renderHook(() => useCategories(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.create({ name: "Dom", parent_id: null })).resolves.toMatchObject({ id: "3" });
    expect(categoriesApi.createCategory).toHaveBeenCalledWith({ name: "Dom", parent_id: null });
    expect(categoriesApi.getCategories).toHaveBeenCalledTimes(2);

    await result.current.update("2", { name: "Komiksy" });
    expect(categoriesApi.updateCategory).toHaveBeenCalledWith("2", { name: "Komiksy" });
    expect(categoriesApi.getCategories).toHaveBeenCalledTimes(3);
  });

  it("create() rethrows the backend error without refetching", async () => {
    vi.mocked(categoriesApi.getCategories).mockResolvedValue(mockCategories);
    const conflict = new ApiError(409, "Conflict", { status: 409, error: "Conflict", message: "Duplikat" });
    vi.mocked(categoriesApi.createCategory).mockRejectedValue(conflict);

    const { result } = renderHook(() => useCategories(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.create({ name: "Zabawki" })).rejects.toBe(conflict);
    expect(categoriesApi.getCategories).toHaveBeenCalledTimes(1);
  });

  it("keeps the list fresh for 5 minutes, so a remount does not refetch", async () => {
    vi.mocked(categoriesApi.getCategories).mockResolvedValue(mockCategories);
    const wrapper = createQueryWrapper(createTestQueryClient());

    const first = renderHook(() => useCategories(), { wrapper });
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();

    const second = renderHook(() => useCategories(), { wrapper });

    expect(second.result.current.data).toEqual(mockCategories);
    expect(categoriesApi.getCategories).toHaveBeenCalledTimes(1);
  });
});
