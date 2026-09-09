import { api } from "./client";

export type NeededItemCategory = "INSTRUMENT" | "MAT_BLANKET" | "ART_SUPPLIES" | "OTHER";

export interface TermResponse {
  id: number;
  circle_group_id: number;
  occurs_on: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateTermRequest {
  circle_group_id: number;
  occurs_on: string;
  description?: string;
}

export interface NeededItemResponse {
  id: number;
  term_id: number;
  category: NeededItemCategory;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateNeededItemRequest {
  term_id: number;
  category: NeededItemCategory;
  description?: string;
}

export function getTerms(circleGroupId: number): Promise<TermResponse[]> {
  return api.get(`/terms?circle_group_id=${circleGroupId}`);
}

export function getTerm(id: number): Promise<TermResponse> {
  return api.get(`/terms/${id}`);
}

export function createTerm(request: CreateTermRequest): Promise<TermResponse> {
  return api.post("/terms", request);
}

export interface UpdateTermRequest {
  occurs_on?: string;
  description?: string;
}

export function updateTerm(id: number, request: UpdateTermRequest): Promise<TermResponse> {
  return api.patch(`/terms/${id}`, request);
}

export function getNeededItems(termId: number): Promise<NeededItemResponse[]> {
  return api.get(`/needed-items?term_id=${termId}`);
}

export function getNeededItem(id: number): Promise<NeededItemResponse> {
  return api.get(`/needed-items/${id}`);
}

export function createNeededItem(request: CreateNeededItemRequest): Promise<NeededItemResponse> {
  return api.post("/needed-items", request);
}

export interface UpdateNeededItemRequest {
  category?: NeededItemCategory;
  description?: string;
}

export function updateNeededItem(
  id: number,
  request: UpdateNeededItemRequest,
): Promise<NeededItemResponse> {
  return api.patch(`/needed-items/${id}`, request);
}

export function deleteNeededItem(id: number): Promise<void> {
  return api.delete(`/needed-items/${id}`);
}
