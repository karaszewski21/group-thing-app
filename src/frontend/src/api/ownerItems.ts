import { api } from "./client";
import type { ExchangeMode, ReservedByResponse } from "./groups";
import { pageParams } from "./pagination";
import type { PublicMediaSet } from "./media";

/** Mirrors `app.groups.schemas.OwnerItemCardResponse`. */
export interface OwnerItemCard {
  item_id: string;
  product_name: string;
  condition: string;
  mode: ExchangeMode;
  thumb_url: string | null;
  /** Naive UTC ISO, no offset. */
  added_at: string;
  /** `null` while the item is available. */
  reservation: ReservedByResponse | null;
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
  /** Over every listed item (reserved included), ignoring the `mode` filter. */
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
  return api.get(`/public/organizers/${encodeURIComponent(slug)}/items?${query(page, mode)}`);
}

/** `/<party-id>/items`: any person's listed items, newest first. */
export function getPartyOwnerItems(
  partyId: string,
  page: number,
  mode?: ExchangeMode,
): Promise<OwnerItemsPageResponse> {
  return api.get(`/public/parties/${encodeURIComponent(partyId)}/items?${query(page, mode)}`);
}

/** An Organization a person owns: a separate page, linked from the profile. */
export interface OrganizationLink {
  name: string;
  slug: string;
}

/** Mirrors `app.groups.schemas.PartyProfileResponse`: a person's public
 * profile behind `/<party-id>`, always the person (`owner.slug` is `null`);
 * an Organization they own is linked through `organization`. */
export interface PartyProfileResponse extends PublicMediaSet {
  owner: OwnerItemsPageResponse["owner"];
  organization: OrganizationLink | null;
  bio: string | null;
  /** The effective layout key and the theme the person chose. */
  page_layout: string;
  palette_preset: string | null;
  primary_color: string | null;
  accent_color: string | null;
  nearest: OwnerNearestDate | null;
  counts: Record<ExchangeMode, number>;
  /** The newest listed items, at most 6. */
  recent_items: OwnerItemCard[];
  is_me: boolean;
}

/** `/<party-id>`: 404 for a person with nothing public. */
export function getPartyProfile(partyId: string): Promise<PartyProfileResponse> {
  return api.get(`/public/parties/${encodeURIComponent(partyId)}`);
}

/** Mirrors `app.groups.schemas.OwnerMeetingsResponse`: the owner's upcoming
 * public terms and events, earliest first, at most 50. */
export interface OwnerMeetingsResponse {
  /** `slug` set on a party URL means an Organization owner: redirect. */
  owner: OwnerItemsPageResponse["owner"];
  meetings: OwnerNearestDate[];
}

/** `/<org-slug>/meetings`. */
export function getOrganizationOwnerMeetings(slug: string): Promise<OwnerMeetingsResponse> {
  return api.get(`/public/organizers/${encodeURIComponent(slug)}/meetings`);
}

/** `/<party-id>/meetings`: 404 for a person with nothing public. */
export function getPartyOwnerMeetings(partyId: string): Promise<OwnerMeetingsResponse> {
  return api.get(`/public/parties/${encodeURIComponent(partyId)}/meetings`);
}
