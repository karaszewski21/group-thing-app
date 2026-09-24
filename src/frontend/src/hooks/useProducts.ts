import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type {
  ProductResponse,
  CreateProductRequest,
  UpdateProductRequest,
} from "../api/products";
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
  category_id?: number;
  search?: string;
  sortField?: string;
  pluginFilters?: string[];
}

const PRODUCTS_KEY = ["products"] as const;
const NO_PRODUCTS: ProductResponse[] = [];

function errorMessage(err: Error): string {
  return err.message || "Failed to load products";
}

export function useProducts(params?: UseProductsParams): UseProductsResult {
  const queryClient = useQueryClient();
  const categoryId = params?.category_id;
  const search = params?.search;
  const sortField = params?.sortField;
  const pluginFilters = params?.pluginFilters;

  const query = useQuery({
    queryKey: [...PRODUCTS_KEY, { categoryId, search, sortField, pluginFilters }],
    queryFn: () =>
      getProducts({
        category_id: categoryId,
        search: search,
        sort: sortField ? `${sortField},asc` : undefined,
        pluginFilters: pluginFilters,
      }),
  });
  const { refetch: queryRefetch } = query;

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  // Invalidates every product list, not just this one's filter combination:
  // a create/update/delete can move a product into or out of any of them.
  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY }),
    [queryClient],
  );

  const create = useCallback(async (request: CreateProductRequest) => {
    const created = await apiCreateProduct(request);
    await invalidate();
    return created;
  }, [invalidate]);

  const update = useCallback(async (id: number, request: UpdateProductRequest) => {
    const updated = await apiUpdateProduct(id, request);
    await invalidate();
    return updated;
  }, [invalidate]);

  const remove = useCallback(async (id: number) => {
    await apiDeleteProduct(id);
    await invalidate();
  }, [invalidate]);

  return {
    data: query.data ?? NO_PRODUCTS,
    loading: query.isPending,
    error: query.error ? errorMessage(query.error) : null,
    refetch,
    create,
    update,
    remove,
  };
}
