import { api } from "./client";

export type PledgeStatus = "OPEN" | "CLAIMED" | "WITHDRAWN" | "FULFILLED";

export interface PledgeResponse {
  id: string;
  needed_item_id: string;
  pledged_by_party_id: string;
  status: PledgeStatus;
  created_at: string;
  updated_at: string;
}

/** One row of the caller's own "rzeczy, które obiecałem przynieść" list. */
export interface MyPledgeResponse {
  pledge_id: string;
  status: PledgeStatus;
  product_name: string;
  item_description: string | null;
  term_id: string;
  group_id: string;
  group_name: string;
  occurs_on: string;
  organizer_slug: string;
}

export function getPledges(neededItemId: string): Promise<PledgeResponse[]> {
  return api.get(`/pledges?needed_item_id=${neededItemId}`);
}

export function getMyPledges(): Promise<MyPledgeResponse[]> {
  return api.get("/pledges/mine");
}

export function getPledge(id: string): Promise<PledgeResponse> {
  return api.get(`/pledges/${id}`);
}

export function createPledge(neededItemId: string): Promise<PledgeResponse> {
  return api.post("/pledges", { needed_item_id: neededItemId });
}

export function withdrawPledge(id: string): Promise<PledgeResponse> {
  return api.post(`/pledges/${id}/withdraw`, undefined);
}
