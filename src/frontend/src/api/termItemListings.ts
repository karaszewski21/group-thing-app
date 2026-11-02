import { api } from "./client";

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
  id: string;
  term_id: string;
  item_id: string;
  lister_party_id: string;
  offered_types: string[];
  resolved_reservation_id: string | null;
  taken_by_party_id: string | null;
  product_name: string;
  condition: string;
  lister_display_name: string;
  created_at: string;
  updated_at: string;
}

export function getMyTermItemListings(termId: string): Promise<BrowseTermItemListingResponse[]> {
  return api.get(`/term-item-listings/mine?term_id=${termId}`);
}

export function getBrowseTermItemListings(termId: string): Promise<BrowseTermItemListingResponse[]> {
  return api.get(`/term-item-listings/browse?term_id=${termId}`);
}

/** The caller's own active (`PENDING`/`CONFIRMED`) taken reservations for
 * this Term — availability-independent, unlike `getBrowseTermItemListings`,
 * so it still resolves once the Term has occurred (the post-term-end
 * `confirm_transaction` flow). */
export function getMyTakenTermItemListings(
  termId: string,
): Promise<BrowseTermItemListingResponse[]> {
  return api.get(`/term-item-listings/mine-as-taker?term_id=${termId}`);
}

/** `PROPOSED` (awaiting the listing owner's decision), `ACCEPTED` or
 * `REJECTED` — mirrors the backend's `SwapProposalStatus` StrEnum. */
export type SwapProposalStatus = "PROPOSED" | "ACCEPTED" | "REJECTED";

export interface SwapProposalResponse {
  id: string;
  proposer_party_id: string;
  listing_item_id: string;
  offered_item_id: string;
  proposer_reservation_id: string;
  status: SwapProposalStatus;
  created_at: string;
  updated_at: string;
}

/** The accept response also names where and when the swap happens. For an
 * event swap `term_id`/`group_id` are null, `term_occurs_on` is the event
 * start and `group_name` the event name; a personal swap has all four null. */
export interface AcceptedSwapProposalResponse extends SwapProposalResponse {
  term_id: string | null;
  term_occurs_on: string | null;
  group_id: string | null;
  group_name: string | null;
  event_id?: string | null;
  event_slug?: string | null;
}

/** A personal swap has no term or event: all four context fields are null
 * (an event swap carries the event start and name). */
export function isPersonalSwapAccept(accepted: AcceptedSwapProposalResponse): boolean {
  return (
    accepted.term_id === null &&
    accepted.term_occurs_on === null &&
    accepted.group_id === null &&
    accepted.group_name === null
  );
}

export const PERSONAL_SWAP_ACCEPTED_MESSAGE = "Zamiana przyjęta — odbiór osobisty, ustalcie szczegóły na czacie.";

export function acceptSwapProposal(proposalId: string): Promise<AcceptedSwapProposalResponse> {
  return api.post(`/swap-proposals/${proposalId}/accept`, undefined);
}

export function rejectSwapProposal(proposalId: string): Promise<SwapProposalResponse> {
  return api.post(`/swap-proposals/${proposalId}/reject`, undefined);
}

/** One pending offer against one of the caller's own SWAP-listed items —
 * enough to render "X oferuje Y" on the `Moje rzeczy` tile and
 * `acceptSwapProposal` directly. */
export interface SwapProposalOfferResponse {
  id: string;
  proposer_party_id: string;
  proposer_display_name: string;
  offered_item_id: string;
  offered_product_name: string;
  created_at: string;
}

/** Every pending `SwapProposal` against `itemId`, for the item's own
 * owner — 403s for anyone else (see `service.list_swap_proposals_for_my_item`). */
export function getSwapProposalsForItem(itemId: string): Promise<SwapProposalOfferResponse[]> {
  return api.get(`/term-item-listings/${itemId}/swap-proposals`);
}
