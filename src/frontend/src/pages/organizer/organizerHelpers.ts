import type { ExchangeMode } from "../../api/groups";

/** Public per-term URL under the organizer's slug. */
export function organizerTermPath(slug: string, groupId: string, termId: string): string {
  return `/${slug}/grupa/${groupId}/term/${termId}`;
}

/** Items offered across every exchange mode. */
export function exchangeTotal(counts: Record<ExchangeMode, number>): number {
  return counts.GIFT + counts.SWAP + counts.LEND;
}
