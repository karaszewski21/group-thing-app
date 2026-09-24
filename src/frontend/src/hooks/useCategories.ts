import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { Category, MoveCategoryDirection } from "../api/categories";
import {
  getCategories,
  deleteCategory as apiDeleteCategory,
  moveCategory as apiMoveCategory,
} from "../api/categories";
import { extractProblemMessage } from "../api/problem";

interface UseCategoriesResult {
  data: Category[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  remove: (id: number) => Promise<void>;
  move: (id: number, direction: MoveCategoryDirection) => Promise<void>;
}

const CATEGORIES_KEY = ["categories"] as const;
const NO_CATEGORIES: Category[] = [];

/**
 * Single source of truth for the frontend's category list (mirrors
 * `useProducts.ts`'s shape). The backend already returns categories
 * ordered by `sort_order` (`app/category/service.py::list_categories`),
 * so this hook doesn't re-sort — it just fetches and exposes. Every caller
 * shares one cached query, so mounting it in several components costs a
 * single request.
 */
export function useCategories(): UseCategoriesResult {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: CATEGORIES_KEY, queryFn: getCategories });
  const { refetch: queryRefetch } = query;

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: CATEGORIES_KEY }),
    [queryClient],
  );

  // Deliberately does NOT swallow the backend's actual error message behind
  // a generic string — e.g. a 409 "category still has N products" conflict
  // needs to reach the caller verbatim so it can be shown inline.
  const remove = useCallback(
    async (id: number) => {
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
    async (id: number, direction: MoveCategoryDirection) => {
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
    remove,
    move,
  };
}
