import { api } from "./client";

export interface TermResponse {
  id: string;
  circle_group_id: string;
  /** ISO datetime — class date *and* wall-clock start time (`2026-03-12T17:30:00`). */
  occurs_on: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  /** Non-withdrawn RSVPs — set only for the term's organizer, else `null`. */
  attendee_count: number | null;
  /** Sum of those RSVPs' `child_count` — `null` alongside `attendee_count`. */
  child_count: number | null;
}

export interface CreateTermRequest {
  circle_group_id: string;
  occurs_on: string;
  description?: string;
}

export interface NeededItemResponse {
  id: string;
  term_id: string;
  product_id: string;
  product_name: string;
  product_category_id: string;
  product_category_name: string;
  description: string | null;
  /** An active (non-withdrawn) pledge exists — "ktoś przyniesie". */
  claimed: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateNeededItemRequest {
  term_id: string;
  product_id: string;
  description?: string;
}

export function getTerms(circleGroupId: string): Promise<TermResponse[]> {
  return api.get(`/terms?circle_group_id=${circleGroupId}`);
}

export function getTerm(id: string): Promise<TermResponse> {
  return api.get(`/terms/${id}`);
}

export function createTerm(request: CreateTermRequest): Promise<TermResponse> {
  return api.post("/terms", request);
}

export interface UpdateTermRequest {
  occurs_on?: string;
  description?: string;
}

export function updateTerm(id: string, request: UpdateTermRequest): Promise<TermResponse> {
  return api.patch(`/terms/${id}`, request);
}

export function getNeededItems(termId: string): Promise<NeededItemResponse[]> {
  return api.get(`/needed-items?term_id=${termId}`);
}

export function getNeededItem(id: string): Promise<NeededItemResponse> {
  return api.get(`/needed-items/${id}`);
}

export function createNeededItem(request: CreateNeededItemRequest): Promise<NeededItemResponse> {
  return api.post("/needed-items", request);
}

export interface UpdateNeededItemRequest {
  product_id?: string;
  description?: string;
}

export function updateNeededItem(
  id: string,
  request: UpdateNeededItemRequest,
): Promise<NeededItemResponse> {
  return api.patch(`/needed-items/${id}`, request);
}

export function deleteNeededItem(id: string): Promise<void> {
  return api.delete(`/needed-items/${id}`);
}
