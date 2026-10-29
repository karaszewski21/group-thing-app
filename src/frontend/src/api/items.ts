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
   * IN_TRANSIT item; null for everyone else. */
  term_id?: string | null;
  group_id?: string | null;
  group_name?: string | null;
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
