import { api } from "./client";
import type { ReservationType } from "./reservations";

/** One row of "Twoje wystawione rzeczy" (`getMyTermItemListings`) or
 * "Rzeczy od innych" (`getBrowseTermItemListings`) — derived server-side
 * from the lister's standing `ItemListingPreference` (set in "Moje rzeczy",
 * see `api/itemListingPreferences.ts`) plus their eligibility (attendance or
 * organizer status) for `term_id`, enriched with cross-BC display data
 * (product name/condition, lister display name) and derived status
 * (`resolved_reservation_id`/`taken_by_party_id`, from the item's live
 * `Reservation` history). `id` is the item's id — one derived listing per
 * item, not per creation event. */
export interface BrowseTermItemListingResponse {
  id: number;
  term_id: number;
  item_id: number;
  lister_party_id: number;
  offered_types: string[];
  resolved_reservation_id: number | null;
  taken_by_party_id: number | null;
  product_name: string;
  condition: string;
  lister_display_name: string;
  created_at: string;
  updated_at: string;
}

/** `offered_item_id` is required for, and only meaningful for, a `SWAP`
 * take. `term_id` is the Term context the take happens in (eligibility,
 * notification link) — the listing itself is Term-independent. */
export interface TakeTermItemListingRequest {
  term_id: number;
  reservation_type: ReservationType;
  offered_item_id?: number;
}

export function getMyTermItemListings(termId: number): Promise<BrowseTermItemListingResponse[]> {
  return api.get(`/term-item-listings/mine?term_id=${termId}`);
}

export function getBrowseTermItemListings(termId: number): Promise<BrowseTermItemListingResponse[]> {
  return api.get(`/term-item-listings/browse?term_id=${termId}`);
}

/** The caller's own active (`PENDING`/`CONFIRMED`) taken reservations for
 * this Term — availability-independent, unlike `getBrowseTermItemListings`,
 * so it still resolves once the Term has occurred (the post-term-end
 * `confirm_transaction` flow). */
export function getMyTakenTermItemListings(
  termId: number,
): Promise<BrowseTermItemListingResponse[]> {
  return api.get(`/term-item-listings/mine-as-taker?term_id=${termId}`);
}

export function takeTermItemListing(
  itemId: number,
  request: TakeTermItemListingRequest,
): Promise<BrowseTermItemListingResponse> {
  return api.post(`/term-item-listings/${itemId}/take`, request);
}

/** `PROPOSED` (awaiting the listing owner's decision), `ACCEPTED` or
 * `REJECTED` — mirrors the backend's `SwapProposalStatus` StrEnum. */
export type SwapProposalStatus = "PROPOSED" | "ACCEPTED" | "REJECTED";

/** Body of `POST /term-item-listings/{item_id}/propose` — `term_id` is the
 * eligibility/notification context (same role as
 * `TakeTermItemListingRequest.term_id`), `offered_item_id` is the
 * proposer's own single counter-offer item (V1 scope: exactly one). */
export interface ProposeSwapRequest {
  term_id: number;
  offered_item_id: number;
}

export interface SwapProposalResponse {
  id: number;
  proposer_party_id: number;
  listing_item_id: number;
  offered_item_id: number;
  proposer_reservation_id: number;
  status: SwapProposalStatus;
  created_at: string;
  updated_at: string;
}

/** SWAP no longer goes through `takeTermItemListing` (the backend rejects
 * it there) — a swap "take" is always a proposal the listing owner must
 * accept or reject. */
export function proposeSwap(
  itemId: number,
  request: ProposeSwapRequest,
): Promise<SwapProposalResponse> {
  return api.post(`/term-item-listings/${itemId}/propose`, request);
}

export function acceptSwapProposal(proposalId: number): Promise<SwapProposalResponse> {
  return api.post(`/swap-proposals/${proposalId}/accept`, undefined);
}

export function rejectSwapProposal(proposalId: number): Promise<SwapProposalResponse> {
  return api.post(`/swap-proposals/${proposalId}/reject`, undefined);
}
