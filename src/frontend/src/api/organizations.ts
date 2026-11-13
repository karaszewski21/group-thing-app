import { api } from "./client";
import type { ExchangeMode, GroupLayoutMode } from "./groups";
import type { OwnerMedia, PublicMediaSet } from "./media";
import type { OwnerItemCard, OwnerItemsPageResponse, OwnerNearestDate } from "./ownerItems";

export interface OrganizationResponse {
  id: string;
  party_id: string;
  name: string;
  slug: string;
  primary_color: string | null;
  accent_color: string | null;
  page_layout: string;
  palette_preset: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface MyOrganizationResponse extends OrganizationResponse {
  media: OwnerMedia[];
}

export interface PublicOrganizationResponse extends PublicMediaSet {
  slug: string;
  name: string;
  primary_color: string | null;
  accent_color: string | null;
  page_layout: string;
  palette_preset: string | null;
  description: string | null;
}

export interface CreateOwnOrganizationRequest {
  name: string;
}

export interface UpdateOrganizationRequest {
  name?: string;
  page_layout?: string;
  palette_preset?: string | null;
  primary_color?: string | null;
  accent_color?: string | null;
  /** A blank value clears it, like `null`. */
  description?: string | null;
}

export function getMyOrganization(): Promise<MyOrganizationResponse> {
  return api.get("/organizations/mine");
}

export function createMyOrganization(
  request: CreateOwnOrganizationRequest,
): Promise<OrganizationResponse> {
  return api.post("/organizations/mine", request);
}

export function updateOrganization(
  id: string,
  request: UpdateOrganizationRequest,
): Promise<OrganizationResponse> {
  return api.patch(`/organizations/${encodeURIComponent(id)}`, request);
}

export function getPublicOrganization(slug: string): Promise<PublicOrganizationResponse> {
  return api.get(`/public/organizations/${encodeURIComponent(slug)}`);
}

/* ------------------------------------------------------------------ */
/*  Public page layouts (`/public/organizations/{slug}/layout/{layout}`) */
/* ------------------------------------------------------------------ */

/** Mirrors `PAGE_LAYOUT_KEYS` in `app/organizations/page_layouts.py`. */
export type PageLayoutKey = "CLASSIC" | "LINKS" | "SCHEDULE" | "EXCHANGE";

/** Counts only what the owner runs, never a date they merely attend. */
export interface OrganizationStats {
  /** PUBLIC groups the owner leads. */
  group_count: number;
  /** Listed PUBLIC items that are not reserved. */
  item_count: number;
  /** Upcoming terms of those groups plus upcoming events the owner authored. */
  meeting_count: number;
}

/** Available (not reserved) listed items per mode. */
export type OrganizationItemStats = Record<ExchangeMode, number>;

export interface OrganizationGroup {
  id: string;
  name: string;
  layout_mode: GroupLayoutMode;
  next_term: { id: string; occurs_on: string; attendee_count: number } | null;
  upcoming_term_count: number;
}

export interface MeetingLink {
  kind: "TERM" | "EVENT";
  starts_at: string;
  path: string;
}

/** Mirrors `app.groups.schemas.OrganizationLayoutResponse`: each layout gets
 * the `stats` plus only the lists its blocks show. */
export type OrganizationLayoutResponse =
  | { layout: "CLASSIC"; stats: OrganizationStats; upcoming_terms: OwnerNearestDate[]; items: OwnerItemCard[] }
  | { layout: "LINKS"; stats: OrganizationStats }
  | {
      layout: "SCHEDULE";
      stats: OrganizationStats;
      upcoming_terms: OwnerNearestDate[];
      /** The owner's newest groups (up to 4). */
      groups: OrganizationGroup[];
      item_stats: OrganizationItemStats;
    }
  | { layout: "EXCHANGE"; stats: OrganizationStats; items: OwnerItemCard[]; term_links: MeetingLink[] };

export function getOrganizationLayout(slug: string, layout: PageLayoutKey): Promise<OrganizationLayoutResponse> {
  return api.get(`/public/organizations/${encodeURIComponent(slug)}/layout/${layout}`);
}

export interface GroupTerm {
  id: string;
  occurs_on: string;
  description: string | null;
  location_name: string | null;
  attendee_count: number;
  path: string;
}

/** Mirrors `app.groups.schemas.OrganizationGroupTermsResponse`: one group of
 * the Organization and its upcoming terms, earliest first, at most 50. */
export interface OrganizationGroupTermsResponse {
  owner: OwnerItemsPageResponse["owner"];
  group: OrganizationGroup;
  /** The group's own description, shown in full only in this page's header. */
  description: string | null;
  terms: GroupTerm[];
}

/** `/<org-slug>/group/<group-id>/terms`: 404 for a group that is not one of
 * the Organization's public groups. */
export function getOrganizationGroupTerms(slug: string, groupId: string): Promise<OrganizationGroupTermsResponse> {
  return api.get(`/public/organizations/${encodeURIComponent(slug)}/groups/${encodeURIComponent(groupId)}/terms`);
}
