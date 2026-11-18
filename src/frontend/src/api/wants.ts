import { api } from "./client";
import type { ExchangeMode } from "./groups";
import type { ProductSearchResult } from "./search";

/** `WITHDRAWN` appears only in the response of the closing call itself:
 * every later read of a withdrawn want is a 404. */
export type WantStatus = "ACTIVE" | "EXPIRED" | "FULFILLED" | "WITHDRAWN";

export type WantCloseOutcome = "FULFILLED" | "WITHDRAWN";

/** One thing the caller is looking for. Timestamps are naive UTC. */
export interface WantResponse {
  id: string;
  name: string;
  note: string | null;
  category_id: string | null;
  /** The category node's own name. */
  category_name: string | null;
  /** The full path joined with " › ", e.g. "Zabawki › Pojazdy dla dzieci". */
  category_path: string | null;
  /** `null` = either way of getting the item. */
  offer_mode: ExchangeMode | null;
  locality_id: string | null;
  locality_name: string | null;
  /** `null` with a locality = that locality alone. */
  radius_km: number | null;
  notifications_enabled: boolean;
  status: WantStatus;
  expires_at: string;
  closed_at: string | null;
  created_at: string;
  /** The matcher has not yet answered the latest create, edit or resume:
   * the matches may still change, so the views poll. */
  matching: boolean;
  /** Real matches only; suggestions are never counted. */
  match_count: number;
  /** Matches the caller has not seen on the match list yet. */
  new_match_count: number;
}

export interface WantCreateRequest {
  name: string;
  note?: string | null;
  category_id?: string | null;
  offer_mode?: ExchangeMode | null;
  locality_id?: string | null;
  /** Only with a locality; `null` or 0 = that locality alone, otherwise 1-100. */
  radius_km?: number | null;
  notifications_enabled?: boolean;
}

/** Any subset of the create fields; only the sent ones change. */
export type WantUpdateRequest = Partial<WantCreateRequest>;

/** An item matching a want, shaped as a product search result (`id` is the item id). */
export interface WantMatchResponse {
  id: string;
  title: string;
  href: string;
  meta: ProductSearchResult["meta"];
  /** Not yet seen on the match list. */
  is_new: boolean;
  reserved_by_me: boolean;
  proposed_by_me: boolean;
}

/** An item missing exactly one word of the want's name ("Może Cię
 * zainteresuje"): the match card without `is_new`, plus the missing words
 * as written in the want. */
export interface WantSuggestionResponse {
  id: string;
  title: string;
  href: string;
  meta: ProductSearchResult["meta"];
  missing_words: string[];
  reserved_by_me: boolean;
  proposed_by_me: boolean;
}

/** The caller's active, expired and fulfilled wants; with `matchedItemId`
 * only the active ones holding that item as a match. */
export function getMyWants(matchedItemId?: string): Promise<WantResponse[]> {
  const query = matchedItemId ? `?${new URLSearchParams({ matched_item_id: matchedItemId })}` : "";
  return api.get(`/wants${query}`);
}

export function createWant(request: WantCreateRequest): Promise<WantResponse> {
  return api.post("/wants", request);
}

export function getWant(id: string): Promise<WantResponse> {
  return api.get(`/wants/${encodeURIComponent(id)}`);
}

export function updateWant(id: string, request: WantUpdateRequest): Promise<WantResponse> {
  return api.patch(`/wants/${encodeURIComponent(id)}`, request);
}

/** Valid for another 90 days from now. */
export function extendWant(id: string): Promise<WantResponse> {
  return api.post(`/wants/${encodeURIComponent(id)}/extend`, undefined);
}

export function closeWant(id: string, outcome: WantCloseOutcome): Promise<WantResponse> {
  return api.post(`/wants/${encodeURIComponent(id)}/close`, { outcome });
}

/** Reactivates an expired or fulfilled want. */
export function resumeWant(id: string): Promise<WantResponse> {
  return api.post(`/wants/${encodeURIComponent(id)}/resume`, undefined);
}

/** Every match, unpaged: available first, then reserved. */
export function getWantMatches(id: string): Promise<WantMatchResponse[]> {
  return api.get(`/wants/${encodeURIComponent(id)}/matches`);
}

/** At most 10 suggestions, best first. */
export function getWantSuggestions(id: string): Promise<WantSuggestionResponse[]> {
  return api.get(`/wants/${encodeURIComponent(id)}/suggestions`);
}

/** Resets `new_match_count`; an active want in its last 30 days is extended too. */
export function markWantMatchesSeen(id: string): Promise<WantResponse> {
  return api.post(`/wants/${encodeURIComponent(id)}/matches/seen`, undefined);
}

export function markWantMatchOpened(id: string, itemId: string): Promise<void> {
  return api.post(`/wants/${encodeURIComponent(id)}/matches/${encodeURIComponent(itemId)}/opened`, undefined);
}
