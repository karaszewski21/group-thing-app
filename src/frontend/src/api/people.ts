import type { LeadershipResponse } from "./groups";
import { api } from "./client";

export interface UserProfileResponse {
  id: number;
  party_id: number;
  account_user_id: number | null;
  display_name: string;
  email: string | null;
  created_at: string;
  updated_at: string;
}

export function getProfile(userProfileId: number): Promise<UserProfileResponse> {
  return api.get(`/people/${userProfileId}`);
}

export function getMyProfile(): Promise<UserProfileResponse> {
  return api.get("/people/me");
}

export function getProfileByParty(partyId: number): Promise<UserProfileResponse> {
  return api.get(`/people/by-party/${partyId}`);
}

export function getLeadershipsForPerson(userProfileId: number): Promise<LeadershipResponse[]> {
  return api.get(`/people/${userProfileId}/leaderships`);
}
