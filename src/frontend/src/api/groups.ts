import { api } from "./client";
import type { ProductCategory } from "./products";

export interface GroupResponse {
  id: number;
  party_id: number;
  name: string;
  organizer_slug: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCircleRequest {
  name: string;
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

/** No `family_group_id` — membership is now per individual guardian/child,
 * resolved server-side from the calling principal, not the whole family. */
export interface CreateMembershipRequest {
  group_id: number;
  valid_from: string;
}

export function getGroups(): Promise<GroupResponse[]> {
  return api.get("/groups");
}

export function getGroup(id: number): Promise<GroupResponse> {
  return api.get(`/groups/${id}`);
}

export function createCircle(request: CreateCircleRequest): Promise<GroupResponse> {
  return api.post("/groups", request);
}

export function createMyCircle(request: CreateCircleRequest): Promise<GroupResponse> {
  return api.post("/groups/mine", request);
}

export function updateCircle(id: number, request: { name: string }): Promise<GroupResponse> {
  return api.patch(`/groups/${id}`, request);
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

export function createMembership(request: CreateMembershipRequest): Promise<MembershipResponse> {
  return api.post("/memberships", request);
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
  product_category: ProductCategory;
  description: string | null;
}

export interface PublicTermResponse {
  id: number;
  occurs_on: string;
  description: string | null;
  needed_items: PublicNeededItemResponse[];
}

export interface PublicGuardianResponse {
  display_name: string;
}

/** Never carries a per-child field — see `app.groups.schemas.PublicCircleResponse`. */
export interface PublicCircleResponse {
  id: number;
  name: string;
  organizer_display_name: string | null;
  organizer_slug: string | null;
  next_term: PublicTermResponse | null;
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

export function createRsvp(groupId: number, request: CreateRsvpRequest): Promise<RsvpResponse> {
  return api.post(`/groups/public/${groupId}/rsvp`, request);
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
