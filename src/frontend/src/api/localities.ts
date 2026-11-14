import { api } from "./client";
import type { Locality } from "./locations";

/** A matching locality; `postal_code` is its smallest matching code in
 * postal mode (`q` like "32-6"), `null` in name mode. */
export interface LocalitySearchResult extends Locality {
  postal_code: string | null;
}

/** `total` is the full match count, beyond the returned `results`. */
export interface LocalitySearchResponse {
  results: LocalitySearchResult[];
  total: number;
}

/** `GET /api/public/localities`: by name prefix or postal code; `limit`
 * 1–20. Public, so a guest can filter `/search` by a locality. */
export function searchLocalities(q: string, limit: number): Promise<LocalitySearchResponse> {
  return api.get(`/public/localities?${new URLSearchParams({ q, limit: String(limit) })}`);
}

/** `GET /api/public/localities/major`: the larger towns (cities with county
 * rights) of every voivodeship, by voivodeship then name. */
export function getMajorTowns(): Promise<Locality[]> {
  return api.get("/public/localities/major");
}

/** `GET /api/public/localities/{id}`: one locality by its SIMC id. */
export function getLocality(id: string): Promise<Locality> {
  return api.get(`/public/localities/${encodeURIComponent(id)}`);
}
