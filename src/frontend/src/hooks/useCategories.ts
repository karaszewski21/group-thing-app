import { useCallback, useEffect, useState } from "react";
import type { CategoryResponse, CreateCategoryRequest, UpdateCategoryRequest } from "../api/categories";
import {
  getCategories,
  createCategory as apiCreateCategory,
  updateCategory as apiUpdateCategory,
  deleteCategory as apiDeleteCategory,
} from "../api/categories";

interface UseCategoriesResult {
  data: CategoryResponse[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  create: (request: CreateCategoryRequest) => Promise<CategoryResponse>;
  update: (id: number, request: UpdateCategoryRequest) => Promise<CategoryResponse>;
  remove: (id: number) => Promise<void>;
}

export function useCategories(): UseCategoriesResult {
  const [data, setData] = useState<CategoryResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const categories = await getCategories();
      setData(categories);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load categories");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const create = useCallback(async (request: CreateCategoryRequest) => {
    const created = await apiCreateCategory(request);
    await refetch();
    return created;
  }, [refetch]);

  const update = useCallback(async (id: number, request: UpdateCategoryRequest) => {
    const updated = await apiUpdateCategory(id, request);
    await refetch();
    return updated;
  }, [refetch]);

  const remove = useCallback(async (id: number) => {
    await apiDeleteCategory(id);
    await refetch();
  }, [refetch]);

  return { data, loading, error, refetch, create, update, remove };
}
