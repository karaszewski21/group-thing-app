import type { LeadershipResponse } from "./groups";
import { api } from "./client";
import type { ModerationStatus } from "./products";

/** The caller's own avatar (`/api/people/me` only). `url` is the 400 px
 * image: public once APPROVED, otherwise a short-lived signed link. */
export interface AvatarResponse {
  url: string;
  status: ModerationStatus;
}

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
  /** Set only on the caller's own profile, in any moderation status. */
  avatar: AvatarResponse | null;
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

/** Multipart upload; replaces the caller's avatar. */
export function uploadMyAvatar(file: File): Promise<AvatarResponse> {
  const body = new FormData();
  body.append("file", file);
  return api.upload("/people/me/avatar", body);
}

export function deleteMyAvatar(): Promise<void> {
  return api.delete("/people/me/avatar");
}

export function getProfileByParty(partyId: string): Promise<UserProfileResponse> {
  return api.get(`/people/by-party/${partyId}`);
}

export function getProfileByAccountUserId(accountUserId: string): Promise<UserProfileResponse> {
  return api.get(`/people/by-account-user-id/${accountUserId}`);
}

export function getLeadershipsForPerson(userProfileId: string): Promise<LeadershipResponse[]> {
  return api.get(`/people/${userProfileId}/leaderships`);
}
