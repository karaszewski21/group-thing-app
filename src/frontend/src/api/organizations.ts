import { api } from "./client";
import type { ModerationStatus } from "./products";

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

export type MediaKind = "LOGO" | "COVER" | "GALLERY";

export interface PublicMedia {
  url: string;
  thumb_url: string;
}

export interface OwnerMedia {
  id: string;
  kind: MediaKind;
  status: ModerationStatus;
  url: string;
  thumb_url: string;
  sort_order: number;
}

export interface MyOrganizationResponse extends OrganizationResponse {
  media: OwnerMedia[];
}

export interface PublicOrganizationResponse {
  slug: string;
  name: string;
  primary_color: string | null;
  accent_color: string | null;
  page_layout: string;
  palette_preset: string | null;
  logo: PublicMedia | null;
  cover: PublicMedia | null;
  gallery: PublicMedia[];
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
  return api.get(`/organizations/public/${encodeURIComponent(slug)}`);
}

export function uploadOrganizationMedia(organizationId: string, kind: MediaKind, file: File): Promise<OwnerMedia> {
  const body = new FormData();
  body.append("file", file);
  return api.upload(`/organizations/${encodeURIComponent(organizationId)}/media?kind=${kind}`, body);
}

export function deleteOrganizationMedia(organizationId: string, mediaId: string): Promise<void> {
  return api.delete(
    `/organizations/${encodeURIComponent(organizationId)}/media/${encodeURIComponent(mediaId)}`,
  );
}

export function reorderOrganizationGallery(organizationId: string, mediaIds: string[]): Promise<OwnerMedia[]> {
  return api.patch(`/organizations/${encodeURIComponent(organizationId)}/media/order`, { media_ids: mediaIds });
}
