import { api } from "./client";

export interface ProductResponse {
  id: number;
  name: string;
  description: string | null;
  photoUrl: string | null;
  sku: string;
  category_id: number;
  pluginData: Record<string, Record<string, unknown>> | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductRequest {
  name: string;
  description?: string;
  photoUrl?: string;
  sku: string;
  category_id: number;
}

export interface UpdateProductRequest {
  name: string;
  description?: string;
  photoUrl?: string;
  sku: string;
  category_id: number;
}

export interface ProductSearchParams {
  category_id?: number;
  search?: string;
  sort?: string;
  pluginFilters?: string[];
}

/** Moderation state of a photo or of a product's name + description. Only
 * owners ever see anything but `APPROVED`. */
export type ModerationStatus = "PENDING" | "APPROVED" | "NEEDS_REVIEW" | "REJECTED";

/** A gallery photo. Photos belong to the catalog product and are shared by
 * every item of it, like the description. `url` is the large (1600 px)
 * image, `thumb_url` the 400 px one. */
export interface ProductPhotoResponse {
  id: string;
  url: string;
  thumb_url: string;
  status: ModerationStatus;
  sort_order: number;
}

export interface ReorderProductPhotosRequest {
  photo_ids: string[];
}

export interface UpdateProductDescriptionRequest {
  description: string | null;
}

export interface ProductDescriptionResponse {
  description: string | null;
}

export interface ResolveProductRequest {
  name: string;
  category_id: string;
}

export function getProducts(params?: ProductSearchParams): Promise<ProductResponse[]> {
  const searchParams = new URLSearchParams();
  if (params?.category_id) searchParams.set("category_id", String(params.category_id));
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

/**
 * Get-or-create a `Product` by freeform name+category (case-insensitive
 * name match within category). Backs `ItemQuickAddForm`'s submission flow —
 * callers resolve a `Product` here before calling `registerInventoryItem`.
 */
export function resolveProduct(request: ResolveProductRequest): Promise<ProductResponse> {
  return api.post("/products/resolve", request);
}

export function addProductPhoto(productId: string, file: File): Promise<ProductPhotoResponse> {
  const body = new FormData();
  body.append("file", file);
  return api.upload(`/products/${productId}/photos`, body);
}

export function deleteProductPhoto(productId: string, photoId: string): Promise<void> {
  return api.delete(`/products/${productId}/photos/${photoId}`);
}

export function reorderProductPhotos(
  productId: string,
  photoIds: string[],
): Promise<ProductPhotoResponse[]> {
  const request: ReorderProductPhotosRequest = { photo_ids: photoIds };
  return api.put(`/products/${productId}/photos/order`, request);
}

export function updateProductDescription(
  productId: string,
  description: string | null,
): Promise<ProductDescriptionResponse> {
  const request: UpdateProductDescriptionRequest = { description };
  return api.patch(`/products/${productId}/description`, request);
}
