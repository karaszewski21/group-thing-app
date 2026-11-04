import { api } from "./client";
import type { ExchangeMode, ReservedByResponse } from "./groups";
import type { ItemVisibility } from "./itemListingPreferences";
import type { Locality } from "./locations";
import type { ReservationType } from "./reservations";

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

/** An upcoming term or event the owner takes part in. `eligible` is whether
 * the logged-in, non-owner viewer may reserve in it. */
export interface ItemContextOptionResponse extends ItemContextResponse {
  /** The term or event place's full `label`. */
  location_name: string | null;
  eligible: boolean;
}

/** The item's place as the viewer may see it: the owner gets the address
 * (and `deleted_at` once removed); anyone else only the locality, with both
 * other keys `null`. */
export interface ItemLocationResponse {
  locality: Locality;
  formatted_address: string | null;
  deleted_at: string | null;
}

/** The caller's part in the item's open reservation or pending swap
 * proposal. `role` is GIVER for the item's holder, RECEIVER for the party who
 * would get it; the flags follow the server's write rules. */
export interface ItemPartyReservationResponse {
  role: "GIVER" | "RECEIVER";
  reservation_id: string | null;
  proposal_id: string | null;
  reservation_type: ReservationType;
  personal_pickup: boolean;
  can_confirm: boolean;
  can_cancel: boolean;
  can_accept: boolean;
  can_reject: boolean;
}

/** Who is looking, decided server-side. */
export type ItemActionsViewer = "ANONYMOUS" | "OWN" | "OTHER";

/** Mirrors `app.groups.schemas.ItemActionsResponse`. */
export interface ItemActionsResponse {
  /** `null` without a listing preference. */
  mode: ExchangeMode | null;
  /** Set only for the owner (`viewer === "OWN"`) of a listed item. */
  visibility: ItemVisibility | null;
  /** ACTIVE, AVAILABLE and without a pending swap proposal. */
  available: boolean;
  /** The reserved badge; `null` while nobody reserves the item. */
  reservation: ReservedByResponse | null;
  party_reservation: ItemPartyReservationResponse | null;
  owner: {
    party_id: string;
    display_name: string;
    /** The owner's Organization slug, or `null` without one. */
    slug: string | null;
    items_total: number;
  };
  viewer: ItemActionsViewer;
  /** `null` when the item has no place. */
  location: ItemLocationResponse | null;
  /** At most 5 upcoming contexts the viewer may see. */
  contexts: ItemContextOptionResponse[];
  personal_pickup_available: boolean;
}

/** The item page's actions (public). */
export function getItemActions(itemId: string): Promise<ItemActionsResponse> {
  return api.get(`/items/${encodeURIComponent(itemId)}/actions`);
}
