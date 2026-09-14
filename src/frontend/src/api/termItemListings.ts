import { api } from "./client";
import type { ReservationType } from "./reservations";

/** One row of "Twoje wystawione rzeczy" (`getMyTermItemListings`) or
 * "Rzeczy od innych" (`getBrowseTermItemListings`) — derived server-side
 * from the lister's standing `ItemListingPreference` (set in "Moje rzeczy",
 * see `api/itemListingPreferences.ts`) plus their eligibility (attendance or
 * organizer status) for `term_id`, enriched with cross-BC display data
 * (product name/condition, lister display name) and derived status
 * (`resolved_reservation_id`/`taken_by_party_id`, from the item's live
 * `Reservation` history). `id` is the item's id — one derived listing per
 * item, not per creation event. */
export interface BrowseTermItemListingResponse {
  id: number;
  term_id: number;
  item_id: number;
  lister_party_id: number;
  offered_types: string[];
  resolved_reservation_id: number | null;
  taken_by_party_id: number | null;
  product_name: string;
  condition: string;
  lister_display_name: string;
  created_at: string;
  updated_at: string;
}

/** `offered_item_id` is required for, and only meaningful for, a `SWAP`
 * take. `term_id` is the Term context the take happens in (eligibility,
 * notification link) — the listing itself is Term-independent. */
export interface TakeTermItemListingRequest {
  term_id: number;
  reservation_type: ReservationType;
  offered_item_id?: number;
}

export function getMyTermItemListings(termId: number): Promise<BrowseTermItemListingResponse[]> {
  return api.get(`/term-item-listings/mine?term_id=${termId}`);
}

export function getBrowseTermItemListings(termId: number): Promise<BrowseTermItemListingResponse[]> {
  return api.get(`/term-item-listings/browse?term_id=${termId}`);
}

export function takeTermItemListing(
  itemId: number,
  request: TakeTermItemListingRequest,
): Promise<BrowseTermItemListingResponse> {
  return api.post(`/term-item-listings/${itemId}/take`, request);
}
