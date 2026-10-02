import { api } from "./client";
import type { ModerationStatus } from "./products";

export type ModerationSubjectType = "PHOTO" | "PRODUCT_TEXT";

/** `GET /api/moderation/queue` (ADMIN-only) row — a photo or a product's
 * name + description, with the latest model scores (`null` when no model
 * has scored it yet). `photo_url` is a short-lived signed link. */
export interface ModerationQueueEntry {
  subject_type: ModerationSubjectType;
  subject_id: string;
  product_id: string;
  product_name: string;
  description: string | null;
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

export function getModerationQueue(status: ModerationStatus): Promise<ModerationQueueEntry[]> {
  return api.get(`/moderation/queue?status=${status}`);
}

export function decideModeration(request: ModerationDecisionRequest): Promise<void> {
  return api.post("/moderation/decisions", request);
}
