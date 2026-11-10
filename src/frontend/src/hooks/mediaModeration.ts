import type { OwnerMedia } from "../api/media";

/** How often an editor's photos tab re-reads its owner while media awaits moderation. */
export const PENDING_MEDIA_POLL_MS = 10_000;

export function isAwaitingModeration(media: OwnerMedia): boolean {
  return media.status === "PENDING" || media.status === "NEEDS_REVIEW";
}

/** True when a row of `previous` disappeared or changed status in `next`. */
export function mediaStatusChanged(previous: OwnerMedia[], next: OwnerMedia[]): boolean {
  const nextStatus = new Map(next.map((m) => [m.id, m.status]));
  return previous.some((m) => nextStatus.get(m.id) !== m.status);
}
