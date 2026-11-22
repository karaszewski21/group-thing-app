import { api } from "./client";

/** The points valuation size of a category; `null` on a category means it inherits. */
export type SizeClass = "SMALL" | "MEDIUM" | "LARGE";

/** Matches the backend's snake_case `CategoryResponse`; `parent_id` is null for a root. */
export interface Category {
  id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  sort_order: number;
  product_count: number;
  size_class: SizeClass | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCategoryRequest {
  name: string;
  description?: string;
  parent_id?: string | null;
  size_class?: SizeClass | null;
}

/** A full replace: an omitted `size_class` resets the category to inherit. */
export interface UpdateCategoryRequest {
  name: string;
  description?: string;
  size_class: SizeClass | null;
}

export type MoveCategoryDirection = "up" | "down";

export function getCategories(): Promise<Category[]> {
  return api.get("/categories");
}

export function getCategory(id: string): Promise<Category> {
  return api.get(`/categories/${id}`);
}

export function createCategory(request: CreateCategoryRequest): Promise<Category> {
  return api.post("/categories", request);
}

export function updateCategory(id: string, request: UpdateCategoryRequest): Promise<Category> {
  return api.put(`/categories/${id}`, request);
}

export function deleteCategory(id: string): Promise<void> {
  return api.delete(`/categories/${id}`);
}

export function moveCategory(id: string, direction: MoveCategoryDirection): Promise<Category> {
  return api.patch(`/categories/${id}/move`, { direction });
}
