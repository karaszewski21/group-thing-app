import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as categoriesApi from "../api/categories";
import type { Category } from "../api/categories";
import { useCategories } from "../hooks/useCategories";

vi.mock("../api/categories", () => ({
  getCategories: vi.fn(),
  deleteCategory: vi.fn(),
  moveCategory: vi.fn(),
}));

const mockCategories: Category[] = [
  {
    id: 1,
    name: "Zabawki",
    description: null,
    sortOrder: 0,
    productCount: 3,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: 2,
    name: "Książki",
    description: null,
    sortOrder: 1,
    productCount: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];

describe("useCategories", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("fetches and returns categories ordered by sortOrder", async () => {
    vi.mocked(categoriesApi.getCategories).mockResolvedValue(mockCategories);

    const { result } = renderHook(() => useCategories());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(mockCategories);
    expect(result.current.data.map((c) => c.sortOrder)).toEqual([0, 1]);
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

    const { result } = renderHook(() => useCategories());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.remove(1)).rejects.toThrow(
      "Category with id 1 cannot be deleted because it has 3 associated product(s)",
    );
  });
});
