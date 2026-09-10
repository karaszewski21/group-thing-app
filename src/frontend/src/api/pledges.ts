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

/** One row of the caller's own "rzeczy, które obiecałem przynieść" list. */
export interface MyPledgeResponse {
  pledge_id: number;
  status: PledgeStatus;
  product_name: string;
  item_description: string | null;
  term_id: number;
  group_id: number;
  group_name: string;
  occurs_on: string;
  organizer_slug: string;
  /** `true` once a concrete item + LEND reservation are opened — "Rezygnuję" no longer offered. */
  registered: boolean;
}

export function getPledges(neededItemId: number): Promise<PledgeResponse[]> {
  return api.get(`/pledges?needed_item_id=${neededItemId}`);
}

export function getMyPledges(): Promise<MyPledgeResponse[]> {
  return api.get("/pledges/mine");
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
