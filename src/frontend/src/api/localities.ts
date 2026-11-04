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

/** `GET /api/localities`: by name prefix or postal code; `limit` 1–20. */
export function searchLocalities(q: string, limit: number): Promise<LocalitySearchResponse> {
  return api.get(`/localities?${new URLSearchParams({ q, limit: String(limit) })}`);
}
