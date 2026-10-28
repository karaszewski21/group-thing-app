import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type {
  Category,
  CreateCategoryRequest,
  MoveCategoryDirection,
  UpdateCategoryRequest,
} from "../api/categories";
import {
  getCategories,
  createCategory as apiCreateCategory,
  updateCategory as apiUpdateCategory,
  deleteCategory as apiDeleteCategory,
  moveCategory as apiMoveCategory,
} from "../api/categories";
import { extractProblemMessage } from "../api/problem";

interface UseCategoriesResult {
  data: Category[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  create: (request: CreateCategoryRequest) => Promise<Category>;
  update: (id: string, request: UpdateCategoryRequest) => Promise<Category>;
  remove: (id: string) => Promise<void>;
  move: (id: string, direction: MoveCategoryDirection) => Promise<void>;
}

/** Query-key prefix; product writes invalidate it too, since they change `product_count`. */
export const CATEGORIES_KEY = ["categories"] as const;
const NO_CATEGORIES: Category[] = [];
// The full tree is ~2300 categories; every picker mount would otherwise refetch it.
const CATEGORIES_STALE_TIME_MS = 5 * 60_000;

/**
 * Single source of truth for the frontend's category tree (mirrors
 * `useProducts.ts`'s shape): the flat list the backend returns ordered by
 * `sort_order` (`app/category/service.py::list_categories`), not re-sorted
 * here, plus the admin `create`/`update`/`remove`/`move` mutations, each of
 * which invalidates the cached list. Every caller shares one cached query, so
 * mounting it in several components costs a single request.
 */
export function useCategories(): UseCategoriesResult {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: CATEGORIES_KEY,
    queryFn: getCategories,
    staleTime: CATEGORIES_STALE_TIME_MS,
  });
  const { refetch: queryRefetch } = query;

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: CATEGORIES_KEY }),
    [queryClient],
  );

  const create = useCallback(
    async (request: CreateCategoryRequest) => {
      const created = await apiCreateCategory(request);
      await invalidate();
      return created;
    },
    [invalidate],
  );

  const update = useCallback(
    async (id: string, request: UpdateCategoryRequest) => {
      const updated = await apiUpdateCategory(id, request);
      await invalidate();
      return updated;
    },
    [invalidate],
  );

  // Deliberately does NOT swallow the backend's actual error message behind
  // a generic string — e.g. a 409 "category still has N products" conflict
  // needs to reach the caller verbatim so it can be shown inline.
  const remove = useCallback(
    async (id: string) => {
      try {
        await apiDeleteCategory(id);
      } catch (err) {
        throw new Error(extractProblemMessage(err));
      }
      await invalidate();
    },
    [invalidate],
  );

  const move = useCallback(
    async (id: string, direction: MoveCategoryDirection) => {
      await apiMoveCategory(id, direction);
      await invalidate();
    },
    [invalidate],
  );

  return {
    data: query.data ?? NO_CATEGORIES,
    loading: query.isPending,
    error: query.error ? extractProblemMessage(query.error) : null,
    refetch,
    create,
    update,
    remove,
    move,
  };
}
