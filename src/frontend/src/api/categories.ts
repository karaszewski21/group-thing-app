import { api } from "./client";

export interface CategoryResponse {
  id: number;
  name: string;
  description: string | null;
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

export function getCategories(): Promise<CategoryResponse[]> {
  return api.get("/categories");
}

export function getCategory(id: number): Promise<CategoryResponse> {
  return api.get(`/categories/${id}`);
}

export function createCategory(request: CreateCategoryRequest): Promise<CategoryResponse> {
  return api.post("/categories", request);
}

export function updateCategory(id: number, request: UpdateCategoryRequest): Promise<CategoryResponse> {
  return api.put(`/categories/${id}`, request);
}

export function deleteCategory(id: number): Promise<void> {
  return api.delete(`/categories/${id}`);
}
