import { api } from "./client";
import type { ItemCondition, ListingStatus } from "./inventories";
import type { ProductPhotoResponse } from "./products";

export type ItemStatusCode =
  | "AVAILABLE"
  | "RESERVED"
  | "IN_TRANSIT"
  | "RETURNING"
  | "PROPOSED_SWAP"
  | "LENT"
  | "DELETED";


export interface ItemStatusResponse {
  code: ItemStatusCode;
  term_occurs_on: string | null;
  due_date: string | null;
  counterparty_label: string | null;
  /** Set only for a reservation party (taker or giver) of a RESERVED or
   * IN_TRANSIT item; null for everyone else. For an event reservation
   * `term_id`/`group_id` stay null, `group_name` is the event name and
   * `term_occurs_on` its start. */
  term_id?: string | null;
  group_id?: string | null;
  group_name?: string | null;
  event_id?: string | null;
  /** The event author's slug, for `eventPath(event_slug, event_id)`. */
  event_slug?: string | null;
  /** The item's open reservation is a personal pickup (no term or event). */
  personal_pickup: boolean;
}

/** The item page's read model. `description` and `photos` belong to the
 * product (`product_id`) and are shared by every item of it; `deleted_at`
 * is set for a soft-deleted item, which still loads (status `DELETED`). */
export interface ItemDetailsResponse {
  id: string;
  product_id: string;
  name: string;
  category_id: string;
  category_name: string | null;
  condition: ItemCondition;
  listing_status: ListingStatus;
  description: string | null;
  photos: ProductPhotoResponse[];
  product_photo_url: string | null;
  is_owner: boolean;
  deleted_at: string | null;
  status: ItemStatusResponse;
}

export function getItemDetails(id: string): Promise<ItemDetailsResponse> {
  return api.get(`/inventory-items/${encodeURIComponent(id)}/details`);
}
