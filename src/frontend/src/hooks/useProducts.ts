import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type {
  ProductResponse,
  CreateProductRequest,
  UpdateProductRequest,
} from "../api/products";
import {
  getProductsPage,
  createProduct as apiCreateProduct,
  updateProduct as apiUpdateProduct,
  deleteProduct as apiDeleteProduct,
} from "../api/products";

interface UseProductsResult {
  data: ProductResponse[];
  total: number;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  create: (request: CreateProductRequest) => Promise<ProductResponse>;
  update: (id: string, request: UpdateProductRequest) => Promise<ProductResponse>;
  remove: (id: string) => Promise<void>;
}

interface UseProductsParams {
  category_id?: string;
  search?: string;
  sortField?: string;
  pluginFilters?: string[];
  page: number;
}

const PRODUCTS_KEY = ["products"] as const;
const NO_PRODUCTS: ProductResponse[] = [];

function errorMessage(err: Error): string {
  return err.message || "Failed to load products";
}

/** One page of the filtered catalog; the previous page stays shown while
 * the next one loads. */
export function useProducts(params: UseProductsParams): UseProductsResult {
  const queryClient = useQueryClient();
  const { category_id: categoryId, search, sortField, pluginFilters, page } = params;

  const query = useQuery({
    queryKey: [...PRODUCTS_KEY, { categoryId, search, sortField, pluginFilters, page }],
    queryFn: () =>
      getProductsPage(
        {
          category_id: categoryId,
          search: search,
          sort: sortField ? `${sortField},asc` : undefined,
          pluginFilters: pluginFilters,
        },
        page,
      ),
    placeholderData: keepPreviousData,
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

  const update = useCallback(async (id: string, request: UpdateProductRequest) => {
    const updated = await apiUpdateProduct(id, request);
    await invalidate();
    return updated;
  }, [invalidate]);

  const remove = useCallback(async (id: string) => {
    await apiDeleteProduct(id);
    await invalidate();
  }, [invalidate]);

  return {
    data: query.data?.items ?? NO_PRODUCTS,
    total: query.data?.total ?? 0,
    loading: query.isPending,
    error: query.error ? errorMessage(query.error) : null,
    refetch,
    create,
    update,
    remove,
  };
}
