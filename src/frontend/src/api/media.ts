import { api } from "./client";
import type { ModerationStatus } from "./products";

/** LOGO, AVATAR and COVER are single-photo slots; GALLERY is a short list. */
export type MediaKind = "LOGO" | "AVATAR" | "COVER" | "GALLERY";

export interface PublicMedia {
  url: string;
  thumb_url: string;
}

/** The approved images a public page shows. */
export interface PublicMediaSet {
  logo: PublicMedia | null;
  avatar: PublicMedia | null;
  cover: PublicMedia | null;
  gallery: PublicMedia[];
}

/** One of the owner's own images in any moderation status. APPROVED rows
 * carry public CDN links, the rest short-lived signed ones. */
export interface OwnerMedia {
  id: string;
  kind: MediaKind;
  status: ModerationStatus;
  url: string;
  thumb_url: string;
  sort_order: number;
}

/** Whose media an editor changes: an Organization by id, or the caller's
 * own profile. */
export type MediaOwner = { kind: "organization"; organizationId: string } | { kind: "me" };

function mediaBase(owner: MediaOwner): string {
  return owner.kind === "organization"
    ? `/organizations/${encodeURIComponent(owner.organizationId)}/media`
    : "/people/me/media";
}

export function uploadMedia(owner: MediaOwner, kind: MediaKind, file: File): Promise<OwnerMedia> {
  const body = new FormData();
  body.append("file", file);
  return api.upload(`${mediaBase(owner)}?kind=${kind}`, body);
}

export function deleteMedia(owner: MediaOwner, mediaId: string): Promise<void> {
  return api.delete(`${mediaBase(owner)}/${encodeURIComponent(mediaId)}`);
}

export function reorderGallery(owner: MediaOwner, mediaIds: string[]): Promise<OwnerMedia[]> {
  return api.patch(`${mediaBase(owner)}/order`, { media_ids: mediaIds });
}
