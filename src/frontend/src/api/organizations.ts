import { api } from "./client";
import type { OwnerMedia, PublicMediaSet } from "./media";

export interface OrganizationResponse {
  id: string;
  party_id: string;
  name: string;
  slug: string;
  primary_color: string | null;
  accent_color: string | null;
  page_layout: string;
  palette_preset: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface MyOrganizationResponse extends OrganizationResponse {
  media: OwnerMedia[];
}

export interface PublicOrganizationResponse extends PublicMediaSet {
  slug: string;
  name: string;
  primary_color: string | null;
  accent_color: string | null;
  page_layout: string;
  palette_preset: string | null;
  description: string | null;
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
  /** A blank value clears it, like `null`. */
  description?: string | null;
}

export function getMyOrganization(): Promise<MyOrganizationResponse> {
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
  return api.get(`/public/organizations/${encodeURIComponent(slug)}`);
}
