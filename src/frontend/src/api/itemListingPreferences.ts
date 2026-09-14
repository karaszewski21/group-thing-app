import { api } from "./client";
import type { ReservationType } from "./reservations";

export interface ItemListingPreferenceResponse {
  id: number;
  item_id: number;
  owner_party_id: number;
  mode: string;
  created_at: string;
  updated_at: string;
}

/** Sets, changes, or (when `mode` is `null`) clears the standing
 * lend/gift/swap mode on one of the caller's own items — the "Moje rzeczy"
 * toggle. Independent of any Term: visibility for a given Term is derived
 * server-side from the owner's attendance/organizer status there. */
export function setItemListingPreference(
  itemId: number,
  mode: ReservationType | null,
): Promise<ItemListingPreferenceResponse | null> {
  return api.put(`/item-listing-preferences/${itemId}`, { mode });
}

/** All of the caller's own standing preferences — used to seed each item's
 * mode toggle in "Moje rzeczy" on load. */
export function getMyItemListingPreferences(): Promise<ItemListingPreferenceResponse[]> {
  return api.get("/item-listing-preferences/mine");
}
