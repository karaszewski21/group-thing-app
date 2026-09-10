import { api } from "./client";
import type { ItemCondition } from "./inventories";

export type PledgeStatus = "OPEN" | "CLAIMED" | "WITHDRAWN" | "FULFILLED";

export interface PledgeResponse {
  id: number;
  needed_item_id: number;
  pledged_by_party_id: number;
  status: PledgeStatus;
  resolved_reservation_id: number | null;
  created_at: string;
  updated_at: string;
}

/** Exactly one mode:
 * - `{ inventory_item_id }` — an item the pledger already owns (must be AVAILABLE).
 * - `{ condition, product_id? }` — register a fresh item; `product_id` defaults
 *   server-side to the product the NeededItem names. */
export type FulfillPledgeRequest =
  | { inventory_item_id: number }
  | { condition: ItemCondition; product_id?: number };

export function getPledges(neededItemId: number): Promise<PledgeResponse[]> {
  return api.get(`/pledges?needed_item_id=${neededItemId}`);
}

export function getPledge(id: number): Promise<PledgeResponse> {
  return api.get(`/pledges/${id}`);
}

export function createPledge(neededItemId: number): Promise<PledgeResponse> {
  return api.post("/pledges", { needed_item_id: neededItemId });
}

export function withdrawPledge(id: number): Promise<PledgeResponse> {
  return api.post(`/pledges/${id}/withdraw`, undefined);
}

export function fulfillPledge(id: number, request: FulfillPledgeRequest): Promise<PledgeResponse> {
  return api.post(`/pledges/${id}/fulfill`, request);
}

export function syncPledgeFulfillment(id: number): Promise<PledgeResponse> {
  return api.post(`/pledges/${id}/sync`, undefined);
}
