import { api } from "./client";

/** The participant-visualization layout an organizer picks for their
 * Circle's `/krag/{id}` screen — mirrors `app.groups.models.GroupLayoutMode`.
 * Kept as its own literal union here (rather than importing
 * `GroupVisualization.tsx`'s `GroupLayoutMode`) so the API layer doesn't
 * depend on a UI component module — see that file's `VisualizationFamily`
 * docstring for the same decoupling rationale. */
export type GroupLayoutMode = "CIRCLE" | "PITCH" | "TABLE";

/** Mirrors `app.groups.models.GroupVisibility` — `PUBLIC` (today's only
 * behavior: anyone RSVPs per-term, optionally without an account) vs
 * `PRIVATE` (only standing members/organizer may RSVP; new members join
 * only via the group's join link, which creates standing membership). */
export type GroupVisibility = "PUBLIC" | "PRIVATE";

export interface GroupResponse {
  id: number;
  party_id: number;
  name: string;
  organizer_slug: string | null;
  layout_mode: GroupLayoutMode;
  visibility: GroupVisibility;
  created_at: string;
  updated_at: string;
}

export interface CreateCircleRequest {
  name: string;
  visibility?: GroupVisibility;
}

/** `GET /api/groups/moderation` (ADMIN-only) row — every Circle with its
 * current organizer (if any) and aggregated member/term counts. */
export interface ModerationGroupResponse {
  id: number;
  name: string;
  created_at: string;
  organizer_name: string | null;
  organizer_email: string | null;
  member_count: number;
  term_count: number;
}

/** `organizer_party_id` is denormalized by the backend — no second lookup
 * through `GroupRoleResponse` needed just to find out who this is. */
export interface LeadershipResponse {
  id: number;
  from_role_id: number;
  to_group_id: number;
  organizer_party_id: number;
  valid_from: string;
  valid_to: string | null;
}

export interface AssignLeadershipRequest {
  group_id: number;
  organizer_party_id: number;
  valid_from: string;
}

/** `member_party_id` is denormalized the same way as
 * `LeadershipResponse.organizer_party_id`. */
export interface MembershipResponse {
  id: number;
  from_role_id: number;
  to_group_id: number;
  member_party_id: number;
  valid_from: string;
  valid_to: string | null;
}

export function getGroups(): Promise<GroupResponse[]> {
  return api.get("/groups");
}

export function getGroupsForModeration(): Promise<ModerationGroupResponse[]> {
  return api.get("/groups/moderation");
}

export function getGroup(id: number): Promise<GroupResponse> {
  return api.get(`/groups/${id}`);
}

export function createCircle(request: CreateCircleRequest): Promise<GroupResponse> {
  return api.post("/groups", request);
}

/** Idempotent "become an Organizer" — a caller who already leads a Circle
 * gets that same Circle back. Only for the one-time first-circle flows
 * (`FirstTermStepperGuest`, onboarding) — NOT for "add another group"
 * (see `createAdditionalMyCircle`). */
export function createMyCircle(request: CreateCircleRequest): Promise<GroupResponse> {
  return api.post("/groups/mine", request);
}

/** Non-idempotent — always creates a brand new Circle led by the caller.
 * The Panel's "+ Dodaj grupę" button targets this, never `createMyCircle`,
 * whose idempotency would silently no-op a repeat organizer's click. */
export function createAdditionalMyCircle(request: CreateCircleRequest): Promise<GroupResponse> {
  return api.post("/groups/mine/new", request);
}

/** `PATCH /groups/{id}` with `layout_mode` (and, optionally, `visibility`)
 * set — `name` is a required field on `UpdateGroupRequest` ("required
 * value, not partial-apply", per that schema's docstring), so the caller's
 * current group name must be supplied alongside the new layout mode.
 * `visibility` is omitted from the request body entirely when not passed,
 * leaving the group's current visibility untouched (mirrors the backend's
 * `is not None`-only-apply semantics) — existing callers that only ever
 * change `layout_mode` are unaffected. */
export function updateGroupLayoutMode(
  id: number,
  name: string,
  layoutMode: GroupLayoutMode,
  visibility?: GroupVisibility,
): Promise<GroupResponse> {
  return api.patch(`/groups/${id}`, {
    name,
    layout_mode: layoutMode,
    ...(visibility !== undefined ? { visibility } : {}),
  });
}

export function getCurrentLeadership(groupId: number): Promise<LeadershipResponse | null> {
  return api.get(`/groups/${groupId}/leadership`);
}

export function getLeadershipHistory(groupId: number): Promise<LeadershipResponse[]> {
  return api.get(`/groups/${groupId}/leaderships`);
}

export function assignLeadership(request: AssignLeadershipRequest): Promise<LeadershipResponse> {
  return api.post("/leaderships", request);
}

export function endLeadership(leadershipId: number, validTo?: string): Promise<LeadershipResponse> {
  const query = validTo ? `?valid_to=${validTo}` : "";
  return api.post(`/leaderships/${leadershipId}/end${query}`, undefined);
}

export function getMembershipsForCircle(groupId: number): Promise<MembershipResponse[]> {
  return api.get(`/groups/${groupId}/memberships`);
}

export function endMembership(membershipId: number, validTo?: string): Promise<MembershipResponse> {
  const query = validTo ? `?valid_to=${validTo}` : "";
  return api.post(`/memberships/${membershipId}/end${query}`, undefined);
}

/* ------------------------------------------------------------------ */
/*  Public circle/term view + RSVP (unauthenticated, `/:slug/grupa/:id/term/:id`) */
/* ------------------------------------------------------------------ */

export interface PublicNeededItemResponse {
  id: number;
  product_id: number;
  product_name: string;
  product_category_id: number;
  product_category_name: string;
  description: string | null;
  /** Someone already declared they'll bring this (single-claim). */
  claimed: boolean;
  claimed_by_name: string | null;
  claimed_by_party_id: number | null;
}

/** A still-available exchange-mechanism offer — always AVAILABLE-only, so
 * no status/taken fields (see `app.groups.schemas.PublicItemListingResponse`). */
export interface PublicItemListingResponse {
  id: number;
  item_id: number;
  product_name: string;
  condition: string;
  offered_types: string[];
  lister_party_id: number;
  lister_display_name: string;
}

export interface PublicTermResponse {
  id: number;
  occurs_on: string;
  description: string | null;
  needed_items: PublicNeededItemResponse[];
  item_listings: PublicItemListingResponse[];
}

export interface PublicGuardianResponse {
  party_id: number;
  display_name: string;
}

/** Never carries a per-child field — see `app.groups.schemas.PublicCircleResponse`.
 * For a `PRIVATE` group, `term`/`guardians` come back empty/null even
 * when Terms exist — see that endpoint's reduced-response docstring. */
export interface PublicCircleResponse {
  id: number;
  name: string;
  organizer_display_name: string | null;
  organizer_slug: string | null;
  visibility: GroupVisibility;
  layout_mode: GroupLayoutMode;
  term: PublicTermResponse | null;
  guardians: PublicGuardianResponse[];
}

export interface CreateRsvpRequest {
  term_id: number;
  guardian_name: string;
  child_count?: number;
}

export interface RsvpResponse {
  id: number;
  term_id: number;
  user_profile_id: number;
  guardian_name: string;
  child_count: number;
  attached_to_account: boolean;
}

export function getPublicCircle(
  groupId: number,
  termId?: number,
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
  /** The caller's latest access request for a PRIVATE group they don't
   * belong to, when it is PENDING or REJECTED; `null` otherwise (anonymous
   * caller, PUBLIC group, member/organizer, or a withdrawn/approved one). */
  join_request: JoinRequestSummary | null;
}

/** Mirrors `app.groups.schemas.GroupAccessResponse` — `GET
 * /groups/public/{groupId}/access`. `group` is the same shape as
 * `getPublicCircle`'s response. */
export interface GroupAccessResponse {
  group: PublicCircleResponse;
  access: GroupAccessDetails;
}

export function getGroupAccess(groupId: number, termId?: number): Promise<GroupAccessResponse> {
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
export function guestProfileIdKey(groupId: number, termId: number): string {
  return `guest_profile_id:${groupId}:${termId}`;
}

/** How long an anonymous guest's identity stays valid in `localStorage`
 * before it's treated as expired — 1 hour, per the approved plan (a guest
 * who RSVPs, closes the tab, and comes back a week later shouldn't be
 * silently treated as "still that guest"). */
const GUEST_PROFILE_TTL_MS = 60 * 60 * 1000;

interface StoredGuestProfile {
  userProfileId: number;
  createdAt: number;
}

/** Writes an anonymous guest's `userProfileId` under `key`, stamped with
 * the current time so `readValidGuestProfile` can later expire it. */
export function writeGuestProfile(key: string, userProfileId: number): void {
  const stored: StoredGuestProfile = { userProfileId, createdAt: Date.now() };
  localStorage.setItem(key, JSON.stringify(stored));
}

/** Reads back a guest profile written by `writeGuestProfile`, returning
 * `null` if it's missing, malformed, or older than `GUEST_PROFILE_TTL_MS`.
 * Also tolerates the old bare-string shape (pre-TTL) by treating it as
 * expired rather than throwing. */
export function readValidGuestProfile(key: string): number | null {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredGuestProfile>;
    if (typeof parsed.userProfileId !== "number" || typeof parsed.createdAt !== "number") {
      return null;
    }
    if (Date.now() - parsed.createdAt > GUEST_PROFILE_TTL_MS) return null;
    return parsed.userProfileId;
  } catch {
    return null;
  }
}

export function createRsvp(groupId: number, request: CreateRsvpRequest): Promise<RsvpResponse> {
  return api.post(`/groups/public/${groupId}/rsvp`, request);
}

/* ------------------------------------------------------------------ */
/*  Formalize a PUBLIC group's past term into standing membership      */
/*  (authenticated organizer action)                                   */
/* ------------------------------------------------------------------ */

/** One RSVP'd Term attendee, resolved for the organizer's "which attendees
 * become standing members" picker — `family_id`/`family_name` are `null`
 * for an attendee with no real Family (not selectable for formalization). */
export interface TermAttendeeResponse {
  party_id: number;
  display_name: string;
  child_count: number;
  family_id: number | null;
  family_name: string | null;
  already_member: boolean;
}

export function getTermAttendeesForFormalization(
  groupId: number,
  termId: number,
): Promise<TermAttendeeResponse[]> {
  return api.get(`/groups/${groupId}/terms/${termId}/attendees`);
}

export function formalizeGroupFromTerm(
  groupId: number,
  termId: number,
  partyIds: number[],
): Promise<GroupResponse> {
  return api.post(`/groups/${groupId}/terms/${termId}/formalize`, { party_ids: partyIds });
}

/* ------------------------------------------------------------------ */
/*  PRIVATE-group access requests (requester: `/groups/public/{id}/    */
/*  join-requests`; organizer: `/groups/{id}/join-requests/{rid}/…`)   */
/* ------------------------------------------------------------------ */

export type JoinRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";

/** The `/access` view of the caller's own latest request. */
export interface JoinRequestSummary {
  id: number;
  status: Extract<JoinRequestStatus, "PENDING" | "REJECTED">;
}

export interface JoinRequestResponse {
  id: number;
  group_id: number;
  requester_party_id: number;
  term_id: number | null;
  status: JoinRequestStatus;
  created_at: string;
  updated_at: string;
}

/** A PENDING request awaiting the organizer's decision, denormalized for
 * the panel's pending-actions list. */
export interface PendingJoinRequestResponse {
  id: number;
  group_id: number;
  group_name: string;
  term_id: number | null;
  requester_party_id: number;
  requester_display_name: string;
  created_at: string;
}

/** Idempotent: an existing PENDING request is returned instead of a new one. */
export function createJoinRequest(groupId: number, termId?: number): Promise<JoinRequestResponse> {
  return api.post(`/groups/public/${groupId}/join-requests`, { term_id: termId ?? null });
}

export function withdrawJoinRequest(groupId: number, requestId: number): Promise<JoinRequestResponse> {
  return api.post(`/groups/public/${groupId}/join-requests/${requestId}/withdraw`, undefined);
}

/** PENDING requests across every group the caller organizes. */
export function listMyPendingJoinRequests(): Promise<PendingJoinRequestResponse[]> {
  return api.get("/groups/mine/join-requests");
}

export function approveJoinRequest(groupId: number, requestId: number): Promise<JoinRequestResponse> {
  return api.post(`/groups/${groupId}/join-requests/${requestId}/approve`, undefined);
}

export function rejectJoinRequest(groupId: number, requestId: number): Promise<JoinRequestResponse> {
  return api.post(`/groups/${groupId}/join-requests/${requestId}/reject`, undefined);
}

/* ------------------------------------------------------------------ */
/*  My attendances (authenticated, `GET /api/groups/mine/attendances`)  */
/* ------------------------------------------------------------------ */

/** One row of the caller's own Term RSVPs — enough to render a panel tile
 * (date, circle name, organizer) and rebuild the public-term link
 * (`organizer_slug` + `group_id` + `term_id`) with no second request. */
export interface MyAttendanceResponse {
  attendance_id: number;
  term_id: number;
  occurs_on: string;
  child_count: number;
  group_id: number;
  group_name: string;
  organizer_display_name: string | null;
  organizer_slug: string;
}

export function getMyAttendances(): Promise<MyAttendanceResponse[]> {
  return api.get("/groups/mine/attendances");
}

/** Bare `TermAttendance` row returned by the withdraw endpoint —
 * `withdrawn_at` is the field callers check to confirm the (idempotent)
 * withdrawal. Deliberately not `MyAttendanceResponse` (which never exposes
 * `withdrawn_at` by design — see that interface's docstring). */
export interface WithdrawAttendanceResponse {
  id: number;
  term_id: number;
  party_id: number;
  child_count: number;
  withdrawn_at: string | null;
}

export function withdrawMyAttendance(attendanceId: number): Promise<WithdrawAttendanceResponse> {
  return api.post(`/groups/mine/attendances/${attendanceId}/withdraw`, undefined);
}

/* ------------------------------------------------------------------ */
/*  Account-merge (anonymous UserProfile -> real account, spec.md §4)   */
/* ------------------------------------------------------------------ */

export interface MergeAnonymousProfileRequest {
  user_profile_id: number;
  email: string;
  password: string;
}

export interface MergeAnonymousProfileResponse {
  token: string;
  party_id: number;
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
  family_id: number;
  shares_item: boolean;
  brings_item: boolean;
}

export interface GroupExchangeSummaryResponse {
  families: FamilyExchangeSummary[];
}

export function getGroupExchangeSummary(groupId: number): Promise<GroupExchangeSummaryResponse> {
  return api.get(`/groups/${groupId}/exchange-summary`);
}

/** One active exchange-mechanism offer from any guardian of a family, for
 * the family card's "DO WYMIANY W GRUPIE" section — field shape reused 1:1
 * from `BrowseTermItemListingResponse`, mirroring
 * `app.groups.schemas.FamilyExchangeOffer`. */
export interface FamilyExchangeOffer {
  id: number;
  item_id: number;
  product_name: string;
  condition: string;
  offered_types: string[];
}

export interface FamilyExchangeDetailResponse {
  family_id: number;
  offers: FamilyExchangeOffer[];
}

export function getFamilyExchangeOffers(
  groupId: number,
  familyId: number,
): Promise<FamilyExchangeDetailResponse> {
  return api.get(`/groups/${groupId}/families/${familyId}/exchange-offers`);
}
