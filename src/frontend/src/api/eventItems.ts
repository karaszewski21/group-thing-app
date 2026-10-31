import { api } from "./client";
import type { ListingMode } from "./itemListingPreferences";
import type { SwapProposalResponse } from "./termItemListings";

/** The term or event an item is reserved in. `name` is the circle's name for
 * a term; `starts_at` is naive Warsaw wall clock; `path` is the context's page. */
export interface ItemContextResponse {
  kind: "TERM" | "EVENT";
  id: string;
  name: string;
  starts_at: string;
  path: string;
  has_started: boolean;
}

export interface EventTakeResponse {
  item_id: string;
  product_name: string;
  context: ItemContextResponse;
}

/** Only `GIFT` is taken directly; a SWAP goes through `proposeEventSwap`. */
export function takeEventItem(
  eventId: string,
  itemId: string,
  reservationType: ListingMode,
): Promise<EventTakeResponse> {
  return api.post(`/events/${eventId}/items/${itemId}/take`, { reservation_type: reservationType });
}

export function proposeEventSwap(
  eventId: string,
  itemId: string,
  offeredItemId: string,
): Promise<SwapProposalResponse> {
  return api.post(`/events/${eventId}/items/${itemId}/propose`, { offered_item_id: offeredItemId });
}
