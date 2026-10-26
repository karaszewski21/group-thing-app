import { api } from "./client";

/** The standing modes an item can be offered in. */
export type ListingMode = "GIFT" | "SWAP";

export interface ItemListingPreferenceResponse {
  id: string;
  item_id: string;
  owner_party_id: string;
  mode: string;
  created_at: string;
  updated_at: string;
}

/** Sets, changes, or (when `mode` is `null`) clears the standing
 * gift/swap mode on one of the caller's own items — the "Moje rzeczy"
 * toggle. Independent of any Term: visibility for a given Term is derived
 * server-side from the owner's attendance/organizer status there. */
export function setItemListingPreference(
  itemId: string,
  mode: ListingMode | null,
): Promise<ItemListingPreferenceResponse | null> {
  return api.put(`/item-listing-preferences/${itemId}`, { mode });
}
