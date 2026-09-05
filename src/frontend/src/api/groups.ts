import { api } from "./client";

export interface GroupResponse {
  id: number;
  party_id: number;
  name: string;
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
