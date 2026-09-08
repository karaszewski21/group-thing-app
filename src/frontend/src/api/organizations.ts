import { api } from "./client";

export interface OrganizationResponse {
  id: number;
  party_id: number;
  name: string;
  slug: string;
  primary_color: string | null;
  accent_color: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicOrganizationResponse {
  slug: string;
  name: string;
  primary_color: string | null;
  accent_color: string | null;
}

export interface CreateOwnOrganizationRequest {
  name: string;
}

export interface UpdateOrganizationRequest {
  name?: string;
  primary_color?: string;
  accent_color?: string;
}

export function getMyOrganization(): Promise<OrganizationResponse> {
  return api.get("/organizations/mine");
}

export function createMyOrganization(
  request: CreateOwnOrganizationRequest,
): Promise<OrganizationResponse> {
  return api.post("/organizations/mine", request);
}

export function updateOrganization(
  id: number,
  request: UpdateOrganizationRequest,
): Promise<OrganizationResponse> {
  return api.patch(`/organizations/${id}`, request);
}

export function getPublicOrganization(slug: string): Promise<PublicOrganizationResponse> {
  return api.get(`/organizations/public/${slug}`);
}
