import type { ExchangeMode } from "../../api/groups";

/** Public per-term URL under the organizer's slug. */
export function organizerTermPath(slug: string, groupId: string, termId: string): string {
  return `/${slug}/group/${groupId}/term/${termId}`;
}

/** Items offered across every exchange mode, plus the organizer's separately
 * counted reserved ones (owner counts already include them in each mode). */
export function exchangeTotal(counts: Record<ExchangeMode, number> & { RESERVED?: number }): number {
  return counts.GIFT + counts.SWAP + (counts.RESERVED ?? 0);
}
