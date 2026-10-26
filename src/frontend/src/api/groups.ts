import { api } from "./client";
import type { LocationRefResponse, PublicLocationResponse } from "./locations";
import { pageParams, type Page } from "./pagination";

/** The participant-visualization layout an organizer picks for their
 * Circle's `/krag/{id}` screen — mirrors `app.groups.models.GroupLayoutMode`.
 * Kept as its own literal union here (rather than importing
 * `GroupVisualization.tsx`'s `GroupLayoutMode`) so the API layer doesn't
 * depend on a UI component module — see that file's `VisualizationFamily`
 * docstring for the same decoupling rationale. */
export type GroupLayoutMode = "CIRCLE" | "PITCH" | "TABLE";

/** Mirrors `app.groups.models.GroupVisibility` — `PUBLIC` (anyone RSVPs
 * per-term, optionally without an account) vs `PRIVATE` (only standing
 * members/organizer may RSVP; new members join by entering the organizer's
 * access code, which creates standing membership). */
export type GroupVisibility = "PUBLIC" | "PRIVATE";

export interface GroupResponse {
  id: string;
  party_id: string;
  name: string;
  organizer_slug: string | null;
  layout_mode: GroupLayoutMode;
  visibility: GroupVisibility;
  created_at: string;
  updated_at: string;
  default_location?: LocationRefResponse | null;
  default_capacity?: number | null;
}

export interface CreateCircleRequest {
  name: string;
  visibility?: GroupVisibility;
}

/** `POST /groups/mine/new` only — `/mine` ignores the defaults. */
export interface CreateAdditionalCircleRequest extends CreateCircleRequest {
  default_location_id?: string | null;
  default_capacity?: number | null;
}

/** `PATCH /groups/{id}`: `name` is required; omitted `layout_mode`/`visibility`
 * keep their value, and the two defaults are kept when omitted and cleared by `null`. */
export interface UpdateGroupRequest {
  name: string;
  layout_mode?: GroupLayoutMode;
  visibility?: GroupVisibility;
  default_location_id?: string | null;
  default_capacity?: number | null;
}

/** `GET /api/groups/moderation` (ADMIN-only) row — every Circle with its
 * current organizer (if any) and aggregated member/term counts. The
 * `deleted_*` fields are set only in the `deleted=true` listing. */
export interface ModerationGroupResponse {
  id: string;
  name: string;
  created_at: string;
  organizer_name: string | null;
  organizer_email: string | null;
  member_count: number;
  term_count: number;
  deleted_at: string | null;
  deleted_by_name: string | null;
}

/** `organizer_party_id` is denormalized by the backend — no second lookup
 * through `GroupRoleResponse` needed just to find out who this is. */
export interface LeadershipResponse {
  id: string;
  from_role_id: string;
  to_group_id: string;
  organizer_party_id: string;
  valid_from: string;
  valid_to: string | null;
}

/** `member_party_id` is denormalized the same way as
 * `LeadershipResponse.organizer_party_id`. */
export interface MembershipResponse {
  id: string;
  from_role_id: string;
  to_group_id: string;
  member_party_id: string;
  valid_from: string;
  valid_to: string | null;
}

export function getGroups(): Promise<GroupResponse[]> {
  return api.get("/groups");
}

/** Active Circles by default; `deleted` lists the soft-deleted ones instead. */
export function getGroupsForModeration(
  page: number,
  deleted = false,
): Promise<Page<ModerationGroupResponse>> {
  const params = new URLSearchParams(pageParams(page));
  if (deleted) params.set("deleted", "true");
  return api.get(`/groups/moderation?${params}`);
}

export function getGroup(id: string): Promise<GroupResponse> {
  return api.get(`/groups/${id}`);
}

/** Soft-deletes a Circle (organizer of it, or ADMIN). */
export function deleteGroup(id: string): Promise<void> {
  return api.delete(`/groups/${id}`);
}

/** ADMIN-only: brings a soft-deleted Circle back. */
export function restoreGroup(id: string): Promise<void> {
  return api.post(`/groups/${id}/restore`, undefined);
}

export function createCircle(request: CreateCircleRequest): Promise<GroupResponse> {
  return api.post("/groups", request);
}

/** Idempotent "become an Organizer" — a caller who already leads a Circle
 * gets that same Circle back. Only for the one-time first-circle flows
 * (onboarding) — NOT for "add another group"
 * (see `createAdditionalMyCircle`). */
export function createMyCircle(request: CreateCircleRequest): Promise<GroupResponse> {
  return api.post("/groups/mine", request);
}

/** Non-idempotent — always creates a brand new Circle led by the caller.
 * The Panel's "+ Dodaj grupę" button targets this, never `createMyCircle`,
 * whose idempotency would silently no-op a repeat organizer's click. */
export function createAdditionalMyCircle(request: CreateAdditionalCircleRequest): Promise<GroupResponse> {
  return api.post("/groups/mine/new", request);
}

export function updateGroup(id: string, request: UpdateGroupRequest): Promise<GroupResponse> {
  return api.patch(`/groups/${encodeURIComponent(id)}`, request);
}

export function getCurrentLeadership(groupId: string): Promise<LeadershipResponse | null> {
  return api.get(`/groups/${groupId}/leadership`);
}

export function getLeadershipHistory(groupId: string): Promise<LeadershipResponse[]> {
  return api.get(`/groups/${groupId}/leaderships`);
}

export function getMembershipsForCircle(groupId: string): Promise<MembershipResponse[]> {
  return api.get(`/groups/${groupId}/memberships`);
}

export function endMembership(membershipId: string, validTo?: string): Promise<MembershipResponse> {
  const query = validTo ? `?valid_to=${validTo}` : "";
  return api.post(`/memberships/${membershipId}/end${query}`, undefined);
}

/* ------------------------------------------------------------------ */
/*  Public circle/term view + RSVP (unauthenticated, `/:slug/grupa/:id/term/:id`) */
/* ------------------------------------------------------------------ */

export interface PublicNeededItemResponse {
  id: string;
  product_id: string;
  product_name: string;
  product_category_id: string;
  product_category_name: string;
  description: string | null;
  /** Someone already declared they'll bring this (single-claim). */
  claimed: boolean;
  claimed_by_name: string | null;
  claimed_by_party_id: string | null;
}

/** A still-available exchange-mechanism offer — always AVAILABLE-only, so
 * no status/taken fields (see `app.groups.schemas.PublicItemListingResponse`). */
export interface PublicItemListingResponse {
  id: string;
  item_id: string;
  product_name: string;
  condition: string;
  offered_types: string[];
  lister_party_id: string;
  lister_display_name: string;
  /** Public CDN URL of the product's first approved photo. */
  thumb_url: string | null;
}

export interface PublicTermResponse {
  id: string;
  occurs_on: string;
  description: string | null;
  needed_items: PublicNeededItemResponse[];
  item_listings: PublicItemListingResponse[];
  location?: PublicLocationResponse | null;
  capacity?: number | null;
  /** Non-withdrawn signups. */
  attendee_count?: number;
}

export interface PublicGuardianResponse {
  party_id: string;
  display_name: string;
}

/** The organizer's stored Organization colors. */
export interface OrganizerTheme {
  primary_color: string | null;
  accent_color: string | null;
  palette_preset: string | null;
}

/** Mirrors `app.groups.schemas.PublicCircleOrganization` — the organizer's
 * own Organization; `null` on the circle when there is none. */
export interface PublicCircleOrganization extends OrganizerTheme {
  name: string;
}

/** Never carries a per-child field — see `app.groups.schemas.PublicCircleResponse`.
 * For a `PRIVATE` group, `term`/`guardians` come back empty/null even
 * when Terms exist — see that endpoint's reduced-response docstring. */
export interface PublicCircleResponse {
  id: string;
  name: string;
  organizer_display_name: string | null;
  organizer_slug: string | null;
  visibility: GroupVisibility;
  layout_mode: GroupLayoutMode;
  term: PublicTermResponse | null;
  guardians: PublicGuardianResponse[];
  organization: PublicCircleOrganization | null;
}

export interface CreateRsvpRequest {
  term_id: string;
  guardian_name: string;
  child_count?: number;
}

export interface RsvpResponse {
  id: string;
  term_id: string;
  user_profile_id: string;
  guardian_name: string;
  child_count: number;
  attached_to_account: boolean;
}

export function getPublicCircle(
  groupId: string,
  termId?: string,
): Promise<PublicCircleResponse> {
  const query = termId !== undefined ? `?term_id=${termId}` : "";
  return api.get(`/groups/public/${groupId}${query}`);
}

/** The caller's server-resolved relationship to a Circle — mirrors
 * `app.groups.schemas.GroupAccessDetails`. Replaces client-side "any auth
 * token means the member view" heuristics: an authenticated visitor who
 * doesn't actually belong to this Circle gets `is_member`/`is_organizer`
 * both `false`, same as an anonymous one. */
export interface GroupAccessDetails {
  is_member: boolean;
  is_organizer: boolean;
  can_view_content: boolean;
  /** The caller has a `TermAttendance` on `group.term`. */
  is_attending: boolean;
  /** Like `is_attending`, but ignores withdrawn attendances (gates "Czat terminu"). */
  is_active_attendee: boolean;
}

/** Mirrors `app.groups.schemas.GroupAccessResponse` — `GET
 * /groups/public/{groupId}/access`. `group` is the same shape as
 * `getPublicCircle`'s response. */
export interface GroupAccessResponse {
  group: PublicCircleResponse;
  access: GroupAccessDetails;
}

export function getGroupAccess(groupId: string, termId: string): Promise<GroupAccessResponse> {
  const query = termId !== undefined ? `?term_id=${termId}` : "";
  return api.get(`/groups/public/${groupId}/access${query}`);
}

/**
 * localStorage key for an anonymous visitor's RSVP identity — scoped per
 * circle+term so a visitor who RSVPs on one Circle's public page doesn't
 * get misread as "already RSVP'd" when they later visit an unrelated
 * Circle's public page (a flat, unscoped key was a real cross-page
 * state-leak bug found during verification).
 */
export function guestProfileIdKey(groupId: string, termId: string): string {
  return `guest_profile_id:${groupId}:${termId}`;
}

/** How long an anonymous guest's identity stays valid in `localStorage`
 * before it's treated as expired — 1 hour, per the approved plan (a guest
 * who RSVPs, closes the tab, and comes back a week later shouldn't be
 * silently treated as "still that guest"). */
const GUEST_PROFILE_TTL_MS = 60 * 60 * 1000;

interface StoredGuestProfile {
  userProfileId: string;
  createdAt: number;
}

/** Writes an anonymous guest's `userProfileId` under `key`, stamped with
 * the current time so `readValidGuestProfile` can later expire it. */
export function writeGuestProfile(key: string, userProfileId: string): void {
  const stored: StoredGuestProfile = { userProfileId, createdAt: Date.now() };
  localStorage.setItem(key, JSON.stringify(stored));
}

/** Reads back a guest profile written by `writeGuestProfile`, returning
 * `null` if it's missing, malformed, or older than `GUEST_PROFILE_TTL_MS`.
 * Also tolerates the old bare-string shape (pre-TTL) by treating it as
 * expired rather than throwing. */
export function readValidGuestProfile(key: string): string | null {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredGuestProfile>;
    if (typeof parsed.userProfileId !== "string" || typeof parsed.createdAt !== "number") {
      return null;
    }
    if (Date.now() - parsed.createdAt > GUEST_PROFILE_TTL_MS) return null;
    return parsed.userProfileId;
  } catch {
    return null;
  }
}

export function createRsvp(groupId: string, request: CreateRsvpRequest): Promise<RsvpResponse> {
  return api.post(`/groups/public/${groupId}/rsvp`, request);
}

/* ------------------------------------------------------------------ */
/*  Public organizer directory (`/groups/public/organizers/{slug}`)    */
/* ------------------------------------------------------------------ */

export interface OrganizerNextTerm {
  id: string;
  occurs_on: string;
  attendee_count: number;
}

export interface OrganizerCircle {
  id: string;
  name: string;
  layout_mode: GroupLayoutMode;
  next_term: OrganizerNextTerm | null;
  /** Terms in the 60-day window; `next_term` itself has no window. */
  upcoming_term_count: number;
}

export interface OrganizerTerm {
  term_id: string;
  group_id: string;
  group_name: string;
  occurs_on: string;
  description: string | null;
  attendee_count: number;
}

export type ExchangeMode = "GIFT" | "SWAP";

export interface OrganizerExchangeItem {
  item_id: string;
  product_name: string;
  condition: string;
  mode: ExchangeMode;
  thumb_url: string | null;
  term_id: string;
  group_id: string;
  occurs_on: string;
}

export interface OrganizerNeededItem {
  id: string;
  term_id: string;
  group_id: string;
  product_name: string;
  claimed: boolean;
}

export interface OrganizerStats {
  circle_count: number;
  upcoming_term_count: number;
  /** `null` below 3 families. */
  family_count: number | null;
}

/** Mirrors `app.groups.schemas.OrganizerPageResponse`. */
export interface OrganizerPageResponse {
  circles: OrganizerCircle[];
  upcoming_terms: OrganizerTerm[];
  exchange: {
    /** Over every eligible item; `items` is capped, so it may hold fewer. */
    counts: Record<ExchangeMode, number>;
    items: OrganizerExchangeItem[];
  };
  needed_items: OrganizerNeededItem[];
  stats: OrganizerStats;
}

export function getOrganizerPage(slug: string): Promise<OrganizerPageResponse> {
  return api.get(`/groups/public/organizers/${encodeURIComponent(slug)}`);
}

export function getOrganizerTerms(
  slug: string,
  page: number,
  groupId?: string,
): Promise<Page<OrganizerTerm>> {
  const params = new URLSearchParams(pageParams(page));
  if (groupId !== undefined) params.set("group_id", groupId);
  return api.get(`/groups/public/organizers/${encodeURIComponent(slug)}/terms?${params}`);
}

/* ------------------------------------------------------------------ */
/*  A term's attendee list (authenticated organizer read)               */
/* ------------------------------------------------------------------ */

/** One RSVP'd Term attendee, resolved for the organizer's attendee list —
 * `family_id`/`family_name` are `null` for an attendee with no real Family.
 * `children` holds only the birth years of that family's active children. */
export interface TermAttendeeResponse {
  party_id: string;
  display_name: string;
  child_count: number;
  family_id: string | null;
  family_name: string | null;
  children: { birth_year: number | null }[];
}

export function getTermAttendees(
  groupId: string,
  termId: string,
): Promise<TermAttendeeResponse[]> {
  return api.get(`/groups/${groupId}/terms/${termId}/attendees`);
}

/** One person who RSVP'd to at least one term of a group
 * (`GET /groups/{id}/members`) — visible to the group's organizer and its
 * standing members. `terms_attended` counts the group's terms they signed up
 * for; `last_term_on` is the most recent one (naive Warsaw wall-clock). */
export interface GroupMemberResponse {
  party_id: string;
  display_name: string;
  family_name: string | null;
  terms_attended: number;
  last_term_on: string;
}

export function getGroupMembers(groupId: string): Promise<GroupMemberResponse[]> {
  return api.get(`/groups/${groupId}/members`);
}

/* ------------------------------------------------------------------ */
/*  PRIVATE-group access code (organizer: `/groups/{id}/join-code`;    */
/*  visitor: `/groups/public/{id}/join-code`)                          */
/* ------------------------------------------------------------------ */

export interface JoinCodeResponse {
  /** 6 digits, may start with a zero. */
  code: string;
}

export interface RedeemJoinCodeResponse {
  /** `false` when the caller already was a member or the organizer. */
  created: boolean;
}

/** Organizer only; the code is created on the first read. */
export function getJoinCode(groupId: string): Promise<JoinCodeResponse> {
  return api.get(`/groups/${groupId}/join-code`);
}

/** Organizer only; the old code stops working. */
export function regenerateJoinCode(groupId: string): Promise<JoinCodeResponse> {
  return api.post(`/groups/${groupId}/join-code/regenerate`, undefined);
}

/** Joins the PRIVATE group as a standing member; 409 on a wrong code, 429
 * after too many attempts. */
export function redeemJoinCode(groupId: string, code: string): Promise<RedeemJoinCodeResponse> {
  return api.post(`/groups/public/${groupId}/join-code`, { code });
}

/* ------------------------------------------------------------------ */
/*  My attendances (authenticated, `GET /api/groups/mine/attendances`)  */
/* ------------------------------------------------------------------ */

/** One row of the caller's own Term RSVPs — enough to render a panel tile
 * (date, circle name, organizer) and rebuild the public-term link
 * (`organizer_slug` + `group_id` + `term_id`) with no second request. */
export interface MyAttendanceResponse {
  attendance_id: string;
  term_id: string;
  occurs_on: string;
  child_count: number;
  group_id: string;
  group_name: string;
  organizer_display_name: string | null;
  organizer_slug: string;
  location: PublicLocationResponse | null;
  capacity: number | null;
  /** Non-withdrawn signups for the term, the caller's own included. */
  attendee_count: number;
}

export function getMyAttendances(): Promise<MyAttendanceResponse[]> {
  return api.get("/groups/mine/attendances");
}

/** Bare `TermAttendance` row returned by the withdraw endpoint —
 * `withdrawn_at` is the field callers check to confirm the (idempotent)
 * withdrawal. Deliberately not `MyAttendanceResponse` (which never exposes
 * `withdrawn_at` by design — see that interface's docstring). */
export interface WithdrawAttendanceResponse {
  id: string;
  term_id: string;
  party_id: string;
  child_count: number;
  withdrawn_at: string | null;
}

export function withdrawMyAttendance(attendanceId: string): Promise<WithdrawAttendanceResponse> {
  return api.post(`/groups/mine/attendances/${attendanceId}/withdraw`, undefined);
}

/* ------------------------------------------------------------------ */
/*  Account-merge (anonymous UserProfile -> real account, spec.md §4)   */
/* ------------------------------------------------------------------ */

export interface MergeAnonymousProfileRequest {
  user_profile_id: string;
  email: string;
  password: string;
}

export interface MergeAnonymousProfileResponse {
  token: string;
  party_id: string;
}

export function mergeAnonymousProfile(
  request: MergeAnonymousProfileRequest,
): Promise<MergeAnonymousProfileResponse> {
  return api.post("/groups/public/merge", request);
}

/* ------------------------------------------------------------------ */
/*  Group exchange summary (authenticated,                             */
/*  `GET /groups/{id}/exchange-summary`,                               */
/*  `GET /groups/{id}/families/{familyId}/exchange-offers`)            */
/* ------------------------------------------------------------------ */

/** One family's "udostępnia rzecz"/"przynosi na zajęcia" status marks for
 * the group's current Term — mirrors `app.groups.schemas.FamilyExchangeSummary`. */
export interface FamilyExchangeSummary {
  family_id: string;
  shares_item: boolean;
  brings_item: boolean;
}

export interface GroupExchangeSummaryResponse {
  families: FamilyExchangeSummary[];
}

export function getGroupExchangeSummary(groupId: string): Promise<GroupExchangeSummaryResponse> {
  return api.get(`/groups/${groupId}/exchange-summary`);
}

/** One active exchange-mechanism offer from any guardian of a family, for
 * the family card's "DO WYMIANY W GRUPIE" section — field shape reused 1:1
 * from `BrowseTermItemListingResponse`, mirroring
 * `app.groups.schemas.FamilyExchangeOffer`. */
export interface FamilyExchangeOffer {
  id: string;
  item_id: string;
  product_name: string;
  condition: string;
  offered_types: string[];
}

export interface FamilyExchangeDetailResponse {
  family_id: string;
  offers: FamilyExchangeOffer[];
}

export function getFamilyExchangeOffers(
  groupId: string,
  familyId: string,
): Promise<FamilyExchangeDetailResponse> {
  return api.get(`/groups/${groupId}/families/${familyId}/exchange-offers`);
}
