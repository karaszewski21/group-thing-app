import type { CategoryResponse } from "./categories";
import { api } from "./client";

export interface ProductResponse {
  id: number;
  name: string;
  description: string | null;
  photoUrl: string | null;
  price: number;
  sku: string;
  category: CategoryResponse;
  pluginData: Record<string, Record<string, unknown>> | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductRequest {
  name: string;
  description?: string;
  photoUrl?: string;
  price: number;
  sku: string;
  categoryId: number;
}

export interface UpdateProductRequest {
  name: string;
  description?: string;
  photoUrl?: string;
  price: number;
  sku: string;
  categoryId: number;
}

export interface ProductSearchParams {
  category?: number;
  search?: string;
  sort?: string;
  pluginFilters?: string[];
}

export function getProducts(params?: ProductSearchParams): Promise<ProductResponse[]> {
  const searchParams = new URLSearchParams();
  if (params?.category) searchParams.set("category", String(params.category));
  if (params?.search) searchParams.set("search", params.search);
  if (params?.sort) searchParams.set("sort", params.sort);
  if (params?.pluginFilters) {
    for (const filter of params.pluginFilters) {
      searchParams.append("pluginFilter", filter);
    }
  }
  const query = searchParams.toString();
  return api.get(`/products${query ? `?${query}` : ""}`);
}

export function getProduct(id: number): Promise<ProductResponse> {
  return api.get(`/products/${id}`);
}

export function createProduct(request: CreateProductRequest): Promise<ProductResponse> {
  return api.post("/products", request);
}

export function updateProduct(id: number, request: UpdateProductRequest): Promise<ProductResponse> {
  return api.put(`/products/${id}`, request);
}

export function deleteProduct(id: number): Promise<void> {
  return api.delete(`/products/${id}`);
}
