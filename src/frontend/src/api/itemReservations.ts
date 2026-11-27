import { api } from "./client";
import type { ItemContextResponse } from "./itemActions";
import type { ListingMode } from "./itemListingPreferences";
import type { SwapProposalResponse } from "./termItemListings";

/** Where a take/propose happens: a term or event by id, or a personal pickup
 * at the owner's place, which carries no id. */
export type ReservationContextRef = { kind: "PERSONAL" } | { kind: "TERM" | "EVENT"; id: string };

/** `GIFT` and `POINTS` are taken directly; a SWAP goes through
 * `proposeItemSwap`. `points_price` is the price the buyer saw: the server
 * requires it for POINTS (a different current price is a 409) and refuses it
 * otherwise. */
export interface ItemTakeRequest {
  context: ReservationContextRef;
  reservation_type: ListingMode;
  points_price?: number;
}

export interface ItemProposeRequest {
  context: ReservationContextRef;
  offered_item_id: string;
}

/** `context` is null for a personal pickup. */
export interface ItemTakeResponse {
  item_id: string;
  product_name: string;
  context: ItemContextResponse | null;
}

export function takeItem(itemId: string, request: ItemTakeRequest): Promise<ItemTakeResponse> {
  return api.post(`/items/${encodeURIComponent(itemId)}/take`, request);
}

export function proposeItemSwap(itemId: string, request: ItemProposeRequest): Promise<SwapProposalResponse> {
  return api.post(`/items/${encodeURIComponent(itemId)}/propose`, request);
}
