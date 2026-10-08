import { api } from "./client";

export interface OrganizationResponse {
  id: string;
  party_id: string;
  name: string;
  slug: string;
  primary_color: string | null;
  accent_color: string | null;
  page_layout: string;
  palette_preset: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicOrganizationResponse {
  slug: string;
  name: string;
  primary_color: string | null;
  accent_color: string | null;
  page_layout: string;
  palette_preset: string | null;
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
  id: string,
  request: UpdateOrganizationRequest,
): Promise<OrganizationResponse> {
  return api.patch(`/organizations/${encodeURIComponent(id)}`, request);
}

export function getPublicOrganization(slug: string): Promise<PublicOrganizationResponse> {
  return api.get(`/organizations/public/${encodeURIComponent(slug)}`);
}
