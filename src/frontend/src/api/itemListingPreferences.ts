import { api } from "./client";

/** The standing modes an item can be offered in. */
export type ListingMode = "GIFT" | "SWAP";

/** Who sees a listed item: everyone, or only the owner's private circles. */
export type ItemVisibility = "PUBLIC" | "PRIVATE";

export interface ItemListingPreferenceResponse {
  id: string;
  item_id: string;
  owner_party_id: string;
  mode: string;
  visibility: ItemVisibility;
  created_at: string;
  updated_at: string;
}

/** Sets, changes, or (when `mode` is `null`) clears the standing
 * gift/swap mode on one of the caller's own items — the "Moje rzeczy"
 * toggle. Without `visibility` the server keeps the current one (PUBLIC
 * for a new listing). A visibility change must always carry the item's
 * current mode: the server rejects `visibility` without a mode. */
export function setItemListingPreference(
  itemId: string,
  mode: ListingMode,
  visibility?: ItemVisibility,
): Promise<ItemListingPreferenceResponse | null>;
export function setItemListingPreference(
  itemId: string,
  mode: ListingMode | null,
): Promise<ItemListingPreferenceResponse | null>;
export function setItemListingPreference(
  itemId: string,
  mode: ListingMode | null,
  visibility?: ItemVisibility,
): Promise<ItemListingPreferenceResponse | null> {
  return api.put(`/item-listing-preferences/${itemId}`, visibility ? { mode, visibility } : { mode });
}
