import { useCallback, useEffect, useState } from "react";
import type { ProductResponse, CreateProductRequest, UpdateProductRequest } from "../api/products";
import {
  getProducts,
  createProduct as apiCreateProduct,
  updateProduct as apiUpdateProduct,
  deleteProduct as apiDeleteProduct,
} from "../api/products";

interface UseProductsResult {
  data: ProductResponse[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  create: (request: CreateProductRequest) => Promise<ProductResponse>;
  update: (id: number, request: UpdateProductRequest) => Promise<ProductResponse>;
  remove: (id: number) => Promise<void>;
}

interface UseProductsParams {
  categoryId?: number;
  search?: string;
  sortField?: string;
  pluginFilters?: string[];
}

export function useProducts(params?: UseProductsParams): UseProductsResult {
  const [data, setData] = useState<ProductResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const categoryId = params?.categoryId;
  const search = params?.search;
  const sortField = params?.sortField;
  const pluginFilters = params?.pluginFilters;
  const pluginFiltersKey = pluginFilters?.join("\0") ?? "";

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const products = await getProducts({
        category: categoryId,
        search: search,
        sort: sortField ? `${sortField},asc` : undefined,
        pluginFilters: pluginFilters,
      });
      setData(products);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load products");
    } finally {
      setLoading(false);
    }
  }, [categoryId, search, sortField, pluginFiltersKey]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const create = useCallback(async (request: CreateProductRequest) => {
    const created = await apiCreateProduct(request);
    await refetch();
    return created;
  }, [refetch]);

  const update = useCallback(async (id: number, request: UpdateProductRequest) => {
    const updated = await apiUpdateProduct(id, request);
    await refetch();
    return updated;
  }, [refetch]);

  const remove = useCallback(async (id: number) => {
    await apiDeleteProduct(id);
    await refetch();
  }, [refetch]);

  return { data, loading, error, refetch, create, update, remove };
}
