import { api } from "./client";

/** Mirrors `app.locations.models.LocationSource`. */
export type LocationSource = "GOOGLE" | "MANUAL";

/** `TOWN` for a town (TERYT RM 96), `VILLAGE` for any other locality. */
export type LocalityKind = "TOWN" | "VILLAGE";

/** A TERYT locality from the server's dictionary (`id` is its 7-digit SIMC). */
export interface Locality {
  id: string;
  name: string;
  kind: LocalityKind;
  gmina: string;
  powiat: string;
  voivodeship: string;
}

/** Owner view (`GET /api/locations/mine` and the other `/api/locations` routes).
 * `label` is server-computed: "Kęty, małopolskie" without an address,
 * "Kęty — {formatted_address}" with one. `source` is `null` without an address. */
export interface LocationResponse {
  id: string;
  owner_party_id: string;
  locality: Locality;
  label: string;
  formatted_address: string | null;
  google_place_id: string | null;
  lat: number | null;
  lng: number | null;
  source: LocationSource | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** The place nested in a group, term or event (`default_location`,
 * `location`): no owner, no coordinates. `deleted_at` lets a picker label a
 * soft-deleted, still-referenced place. */
export interface LocationRefResponse {
  id: string;
  locality: Locality;
  label: string;
  formatted_address: string | null;
  google_place_id: string | null;
  deleted_at: string | null;
}

/** Public/attendance/moderation view: the place, never its owner. */
export interface PublicLocationResponse {
  locality: Locality;
  label: string;
  formatted_address: string | null;
  google_place_id: string | null;
  lat: number | null;
  lng: number | null;
}

/** Body of both `POST` and `PUT /api/locations`. Without `formatted_address`
 * no other address field may be sent; with one, `source` is required:
 * `GOOGLE` requires `google_place_id`, `lat` and `lng`; `MANUAL` forbids
 * `google_place_id` and takes an optional pinned point (`lat` with `lng`). */
export interface LocationRequest {
  locality_id: string;
  formatted_address?: string | null;
  source?: LocationSource;
  google_place_id?: string;
  lat?: number;
  lng?: number;
}

export function getMyLocations(): Promise<LocationResponse[]> {
  return api.get("/locations/mine");
}

/** Always creates a new row (201). */
export function createLocation(request: LocationRequest): Promise<LocationResponse> {
  return api.post("/locations", request);
}

/** Replaces the place's locality and address. */
export function updateLocation(id: string, request: LocationRequest): Promise<LocationResponse> {
  return api.put(`/locations/${encodeURIComponent(id)}`, request);
}

export function deleteLocation(id: string): Promise<void> {
  return api.delete(`/locations/${encodeURIComponent(id)}`);
}
