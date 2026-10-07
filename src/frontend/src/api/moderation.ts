import { api } from "./client";
import { pageParams, type Page } from "./pagination";
import type { ModerationStatus } from "./products";

export type ModerationSubjectType = "PHOTO" | "AVATAR";

/** `GET /api/moderation/photos` (ADMIN-only) row — a product photo with the
 * latest ShieldGemma category scores (`null` when no model has scored it,
 * e.g. VPS B failed after every retry). `photo_url` is the public CDN link
 * once approved, otherwise a short-lived signed link. */
export interface ModerationQueueEntry {
  subject_type: ModerationSubjectType;
  subject_id: string;
  /** `null` for an avatar; `product_name` then holds the profile's name. */
  product_id: string | null;
  product_name: string;
  photo_url: string | null;
  status: ModerationStatus;
  model_id: string | null;
  scores: Record<string, number> | null;
  submitted_at: string;
}

export interface ModerationDecisionRequest {
  subject_type: ModerationSubjectType;
  subject_id: string;
  outcome: "APPROVED" | "REJECTED";
  note?: string;
}

/** `GET /api/moderation/photos` (ADMIN-only) — one page of uploaded photos,
 * newest first, in every status or only in `status` when given. */
export function getModerationPhotos(
  status: ModerationStatus | null,
  page: number,
): Promise<Page<ModerationQueueEntry>> {
  const query = new URLSearchParams(pageParams(page));
  if (status) query.set("status", status);
  return api.get(`/moderation/photos?${query}`);
}

/** `DELETE /api/moderation/photos/{id}` (ADMIN-only) — removes the photo
 * from the database and both of its files from object storage. */
export function deleteModerationPhoto(photoId: string): Promise<void> {
  return api.delete(`/moderation/photos/${photoId}`);
}

export function decideModeration(request: ModerationDecisionRequest): Promise<void> {
  return api.post("/moderation/decisions", request);
}
