import type { MembershipResponse } from "./groups";
import { api } from "./client";

export interface FamilyOut {
  id: number;
  party_id: number;
  name: string;
  created_at: string;
  updated_at: string;
  /** Active CHILD-role member count of the caller's family — populated by
   * the "mine" reads (`GET /api/families/mine`, the `POST
   * /api/families/mine` response); 0 elsewhere. */
  child_count: number;
}

export interface CreateFamilyRequest {
  family_name: string;
  username: string;
  password: string;
  display_name: string;
  email?: string;
}

export interface AddGuardianRequest {
  username: string;
  password: string;
  display_name: string;
  email?: string;
}

/** One entry of the `POST /api/families/mine/members` batch — a family
 * member with no login of their own (lightweight, no `auth.User` row). */
export interface CreateLightweightMemberRequest {
  name: string;
  role_type: "GUARDIAN" | "CHILD";
}

/** Denormalized join of `FamilyMembership` + `UserProfile` — no second
 * round trip needed to find out who a guardian is or whether they're the
 * family's primary contact. */
export interface GuardianResponse {
  family_membership_id: number;
  party_id: number;
  user_profile_id: number;
  display_name: string;
  email: string | null;
  is_primary_contact: boolean;
  valid_from: string;
  valid_to: string | null;
}

export interface FamilyResponse {
  family: FamilyOut;
  guardians: GuardianResponse[];
}

export function createFamily(request: CreateFamilyRequest): Promise<FamilyResponse> {
  return api.post("/families", request);
}

/** Resolves the calling guardian's own Family/Families — replaces the old
 * flat `Person.family_group_id` field now that family membership is a role
 * + relationship, not a direct FK. */
export function getMyFamilies(): Promise<FamilyOut[]> {
  return api.get("/families/mine");
}

/** Same lookup as `getMyFamilies`, but for an arbitrary party (e.g.
 * resolving which Family a fellow Circle member belongs to). */
export function getFamiliesForGuardianParty(partyId: number): Promise<FamilyOut[]> {
  return api.get(`/families/by-guardian-party/${partyId}`);
}

export function getFamily(familyId: number): Promise<FamilyResponse> {
  return api.get(`/families/${familyId}`);
}

/** Idempotent create-own family with a caller-supplied name — a caller who
 * already guards a family gets it back unchanged (use `renameFamily` to
 * rename). */
export function createOwnFamily(name: string): Promise<FamilyOut> {
  return api.post("/families/mine", { name });
}

/** Guardian-only in-place rename. */
export function renameFamily(familyId: number, name: string): Promise<FamilyOut> {
  return api.patch(`/families/${familyId}`, { name });
}

export function addGuardian(familyId: number, request: AddGuardianRequest): Promise<GuardianResponse> {
  return api.post(`/families/${familyId}/guardians`, request);
}

export function getGuardians(familyId: number): Promise<GuardianResponse[]> {
  return api.get(`/families/${familyId}/guardians`);
}

export function makePrimaryContact(
  familyId: number,
  familyMembershipId: number,
): Promise<GuardianResponse[]> {
  return api.post(`/families/${familyId}/guardians/${familyMembershipId}/make-primary`, undefined);
}

export function getMembershipsForFamily(familyId: number): Promise<MembershipResponse[]> {
  return api.get(`/families/${familyId}/memberships`);
}

/** Bootstraps the calling guardian's own Family on first call, then adds
 * every batch member (no per-member API call) — backs the onboarding
 * wizard's "Członkowie rodziny" step, submitted once on step advance. */
export function createLightweightMembers(
  members: CreateLightweightMemberRequest[],
): Promise<FamilyResponse> {
  return api.post("/families/mine/members", { members });
}
