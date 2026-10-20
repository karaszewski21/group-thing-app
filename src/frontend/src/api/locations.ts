import { api } from "./client";

/** Mirrors `app.locations.models.LocationSource`. */
export type LocationSource = "GOOGLE" | "MANUAL";

/** Owner view (`GET /api/locations/mine` and the nested group/term defaults).
 * `deleted_at` lets a picker label a soft-deleted, still-referenced place. */
export interface LocationResponse {
  id: string;
  owner_party_id: string;
  name: string;
  formatted_address: string;
  google_place_id: string | null;
  lat: number | null;
  lng: number | null;
  notes: string | null;
  source: LocationSource;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Public/attendance/moderation view: the place, never its owner. */
export interface PublicLocationResponse {
  name: string;
  formatted_address: string;
  google_place_id: string | null;
  lat: number | null;
  lng: number | null;
  notes: string | null;
}

/** `GOOGLE` requires `google_place_id`, `lat` and `lng`; `MANUAL` forbids them. */
export interface CreateLocationRequest {
  name: string;
  formatted_address: string;
  source: LocationSource;
  google_place_id?: string;
  lat?: number;
  lng?: number;
  notes?: string | null;
}

/** `formatted_address` is accepted only for `MANUAL` rows (409 otherwise). */
export interface UpdateLocationRequest {
  name?: string;
  notes?: string | null;
  formatted_address?: string;
}

export function getMyLocations(): Promise<LocationResponse[]> {
  return api.get("/locations/mine");
}

/** 201 for a new row; 200 with the existing row for an active duplicate `google_place_id`. */
export function createLocation(request: CreateLocationRequest): Promise<LocationResponse> {
  return api.post("/locations", request);
}

export function updateLocation(id: string, request: UpdateLocationRequest): Promise<LocationResponse> {
  return api.patch(`/locations/${encodeURIComponent(id)}`, request);
}

export function deleteLocation(id: string): Promise<void> {
  return api.delete(`/locations/${encodeURIComponent(id)}`);
}
