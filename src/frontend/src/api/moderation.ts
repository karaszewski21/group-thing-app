import { api } from "./client";
import type { ModerationStatus } from "./products";

export type ModerationSubjectType = "PHOTO";

/** `GET /api/moderation/photos` (ADMIN-only) row — a product photo with the
 * latest ShieldGemma category scores (`null` when no model has scored it,
 * e.g. VPS B failed after every retry). `photo_url` is the public CDN link
 * once approved, otherwise a short-lived signed link. */
export interface ModerationQueueEntry {
  subject_type: ModerationSubjectType;
  subject_id: string;
  product_id: string;
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

/** `GET /api/moderation/photos` (ADMIN-only) — the newest uploaded photos in
 * every status, or only in `status` when given. */
export function getModerationPhotos(status: ModerationStatus | null): Promise<ModerationQueueEntry[]> {
  return api.get(status ? `/moderation/photos?status=${status}` : "/moderation/photos");
}

/** `DELETE /api/moderation/photos/{id}` (ADMIN-only) — removes the photo
 * from the database and both of its files from object storage. */
export function deleteModerationPhoto(photoId: string): Promise<void> {
  return api.delete(`/moderation/photos/${photoId}`);
}

export function decideModeration(request: ModerationDecisionRequest): Promise<void> {
  return api.post("/moderation/decisions", request);
}
