import { api } from "./client";

/** Mirrors `api/products.ts`'s camelCase convention (`productCount`,
 * `sortOrder`) — this file is a direct structural mirror of that one. */
export interface Category {
  id: number;
  name: string;
  description: string | null;
  sortOrder: number;
  productCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCategoryRequest {
  name: string;
  description?: string;
}

export interface UpdateCategoryRequest {
  name: string;
  description?: string;
}

export type MoveCategoryDirection = "up" | "down";

export function getCategories(): Promise<Category[]> {
  return api.get("/categories");
}

export function getCategory(id: number): Promise<Category> {
  return api.get(`/categories/${id}`);
}

export function createCategory(request: CreateCategoryRequest): Promise<Category> {
  return api.post("/categories", request);
}

export function updateCategory(id: number, request: UpdateCategoryRequest): Promise<Category> {
  return api.put(`/categories/${id}`, request);
}

export function deleteCategory(id: number): Promise<void> {
  return api.delete(`/categories/${id}`);
}

export function moveCategory(id: number, direction: MoveCategoryDirection): Promise<Category> {
  return api.patch(`/categories/${id}/move`, { direction });
}
