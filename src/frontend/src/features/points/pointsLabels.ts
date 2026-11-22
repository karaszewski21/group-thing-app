import type { PointHistoryEntry, PointTransactionType } from "../../api/points";

export const POINTS_ICON: Record<PointTransactionType, string> = {
  GIVE_FREE: "🎁",
  WISHLIST_MATCH: "🔎",
  EXCHANGE: "🔄",
  ATTENDANCE: "📍",
};

export function pointsTitle(entry: PointHistoryEntry): string {
  switch (entry.type) {
    case "GIVE_FREE":
      return `Oddanie: ${entry.description}`;
    case "WISHLIST_MATCH":
      return `Bonus „Szukam”: ${entry.description}`;
    case "EXCHANGE":
      return `Wymiana: ${entry.description}`;
    case "ATTENDANCE":
      return "Obecność na terminie";
  }
}

/** The part after the date. Polish names cannot be declined automatically,
 * so the counterparty follows a fixed label; null when it is unknown. */
export function pointsSubtitle(entry: PointHistoryEntry): string | null {
  switch (entry.type) {
    case "GIVE_FREE":
      return entry.counterparty_name === null ? null : `Odbiorca: ${entry.counterparty_name}`;
    case "WISHLIST_MATCH":
      return "rzecz z listy odbiorcy";
    case "EXCHANGE":
      return entry.counterparty_name === null ? null : `Druga strona: ${entry.counterparty_name}`;
    case "ATTENDANCE":
      return entry.description;
  }
}

export function signedAmount(amount: number): string {
  return amount > 0 ? `+${amount}` : String(amount);
}
