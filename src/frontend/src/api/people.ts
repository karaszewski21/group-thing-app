import type { LeadershipResponse } from "./groups";
import { api } from "./client";
import type { OwnerMedia } from "./media";

export interface UserProfileResponse {
  id: string;
  party_id: string;
  account_user_id: string | null;
  display_name: string;
  email: string | null;
  /** "O mnie". */
  bio: string | null;
  created_at: string;
  updated_at: string;
  /** Authoritative organizer status (active UserRole(ORGANIZATOR) grant) —
   * independent of whether the account currently leads any Circle. */
  is_organizer: boolean;
  /** The public profile's effective layout key and theme. */
  page_layout: string;
  palette_preset: string | null;
  primary_color: string | null;
  accent_color: string | null;
  /** Only on the caller's own profile: every image in any moderation status. */
  media: OwnerMedia[];
}

/** A `PATCH` of the public profile's look: an omitted field stays, `null`
 * clears it (a blank `bio` too). */
export interface UpdateMyProfileAppearanceRequest {
  page_layout?: string;
  palette_preset?: string | null;
  primary_color?: string | null;
  accent_color?: string | null;
  bio?: string | null;
}

export interface UpdateMyProfileRequest {
  display_name: string;
  bio: string | null;
}

export function getProfile(userProfileId: string): Promise<UserProfileResponse> {
  return api.get(`/people/${userProfileId}`);
}

export function getMyProfile(): Promise<UserProfileResponse> {
  return api.get("/people/me");
}

export function updateMyProfile(request: UpdateMyProfileRequest): Promise<UserProfileResponse> {
  return api.patch("/people/me", request);
}

export function updateMyProfileAppearance(
  request: UpdateMyProfileAppearanceRequest,
): Promise<UserProfileResponse> {
  return api.patch("/people/me/appearance", request);
}

export function getProfileByParty(partyId: string): Promise<UserProfileResponse> {
  return api.get(`/people/by-party/${partyId}`);
}

export function getLeadershipsForPerson(userProfileId: string): Promise<LeadershipResponse[]> {
  return api.get(`/people/${userProfileId}/leaderships`);
}
