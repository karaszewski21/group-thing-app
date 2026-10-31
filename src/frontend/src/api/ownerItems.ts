import { api } from "./client";
import type { ExchangeMode } from "./groups";
import { pageParams } from "./pagination";

/** Mirrors `app.groups.schemas.OwnerItemCardResponse`. */
export interface OwnerItemCard {
  item_id: string;
  product_name: string;
  condition: string;
  mode: ExchangeMode;
  thumb_url: string | null;
  /** Naive UTC ISO, no offset. */
  added_at: string;
}

/** Mirrors `app.groups.schemas.OwnerNearestDateResponse`: the owner's next
 * public term or event. */
export interface OwnerNearestDate {
  kind: "TERM" | "EVENT";
  id: string;
  name: string;
  /** Naive Warsaw wall clock. */
  starts_at: string;
  location_name: string | null;
  attendee_count: number;
  /** The term or event page, under its organizer's slug. */
  path: string;
}

/** Mirrors `app.groups.schemas.OwnerItemsPageResponse`. */
export interface OwnerItemsPageResponse {
  owner: {
    party_id: string;
    /** The owner's Organization name when they have one, else their profile name. */
    display_name: string;
    /** The Organization's slug, or `null` for an owner without one. */
    slug: string | null;
  };
  nearest: OwnerNearestDate | null;
  /** Over every listed item, ignoring the `mode` filter. */
  counts: Record<ExchangeMode, number>;
  items: OwnerItemCard[];
  /** Matching the `mode` filter. */
  total: number;
  page: number;
  size: number;
}

function query(page: number, mode?: ExchangeMode): URLSearchParams {
  const params = new URLSearchParams(pageParams(page));
  if (mode !== undefined) params.set("mode", mode);
  return params;
}

/** `/<org-slug>/items`: the Organization owner's listed items, newest first. */
export function getOrganizationOwnerItems(
  slug: string,
  page: number,
  mode?: ExchangeMode,
): Promise<OwnerItemsPageResponse> {
  return api.get(`/groups/public/organizers/${encodeURIComponent(slug)}/items?${query(page, mode)}`);
}

/** `/<party-id>/items`: any person's listed items, newest first. */
export function getPartyOwnerItems(
  partyId: string,
  page: number,
  mode?: ExchangeMode,
): Promise<OwnerItemsPageResponse> {
  return api.get(`/groups/public/parties/${encodeURIComponent(partyId)}/items?${query(page, mode)}`);
}
