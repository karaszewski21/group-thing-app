import { api } from "./client";
import type { ItemCondition } from "./inventories";
import type { ModerationStatus, ProductPhotoResponse } from "./products";

export type ItemStatusCode =
  | "AVAILABLE"
  | "RESERVED"
  | "IN_TRANSIT"
  | "RETURNING"
  | "PROPOSED_SWAP"
  | "LENT"
  | "DELETED";

export type MovementType = "REGISTER" | "REMOVE" | "GIFT" | "LEND" | "RETURN" | "SWAP";

export interface ItemStatusResponse {
  code: ItemStatusCode;
  term_occurs_on: string | null;
  due_date: string | null;
  counterparty_label: string | null;
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
  description: string | null;
  /** Moderation of the product's name + description; `description` is
   * withheld from non-owners until it is `APPROVED`. */
  text_status: ModerationStatus;
  photos: ProductPhotoResponse[];
  product_photo_url: string | null;
  is_owner: boolean;
  deleted_at: string | null;
  status: ItemStatusResponse;
}

/** One movement, newest first. Carries no ids: `description` is the
 * server-built, privacy-labelled "{from} → {to}" text. */
export interface ItemHistoryEntryResponse {
  occurred_at: string;
  movement_type: MovementType;
  description: string;
  term_occurs_on: string | null;
}

export function getItemDetails(id: string): Promise<ItemDetailsResponse> {
  return api.get(`/inventory-items/${id}/details`);
}

export function getItemHistory(id: string): Promise<ItemHistoryEntryResponse[]> {
  return api.get(`/inventory-items/${id}/history`);
}
