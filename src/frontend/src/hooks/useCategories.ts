import { useCallback, useEffect, useState } from "react";
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

/**
 * Single source of truth for the frontend's category list (mirrors
 * `useProducts.ts`'s shape). The backend already returns categories
 * ordered by `sort_order` (`app/category/service.py::list_categories`),
 * so this hook doesn't re-sort — it just fetches and exposes.
 */
export function useCategories(): UseCategoriesResult {
  const [data, setData] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const categories = await getCategories();
      setData(categories);
    } catch (err) {
      setError(extractProblemMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

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
      await refetch();
    },
    [refetch],
  );

  const move = useCallback(
    async (id: number, direction: MoveCategoryDirection) => {
      await apiMoveCategory(id, direction);
      await refetch();
    },
    [refetch],
  );

  return { data, loading, error, refetch, remove, move };
}
