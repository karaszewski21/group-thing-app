import type { PointHistoryEntry, PointTransactionType } from "../../api/points";

export const POINTS_ICON: Record<PointTransactionType, string> = {
  GIVE_FREE: "🎁",
  WISHLIST_MATCH: "🔎",
  EXCHANGE: "🔄",
  ATTENDANCE: "📍",
  HOLD: "🔒",
  SALE: "🛒",
  RELEASE: "🔓",
};

/** A SALE seen by its buyer: the held points were spent, the balance unchanged. */
export function isPurchase(entry: PointHistoryEntry): boolean {
  return entry.type === "SALE" && entry.held_amount < 0;
}

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
    case "HOLD":
      return `Blokada: ${entry.description}`;
    case "RELEASE":
      return `Zwolnienie blokady: ${entry.description}`;
    case "SALE":
      return isPurchase(entry) ? `Zakup: ${entry.description}` : `Sprzedaż: ${entry.description}`;
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
    case "HOLD":
    case "RELEASE":
      return entry.counterparty_name === null ? null : `Sprzedawca: ${entry.counterparty_name}`;
    case "SALE":
      if (entry.counterparty_name === null) return null;
      return isPurchase(entry) ? `Sprzedawca: ${entry.counterparty_name}` : `Kupujący: ${entry.counterparty_name}`;
  }
}

/** The signed amount with a typographic minus, as in „−60”. */
export function signedAmount(amount: number): string {
  return amount > 0 ? `+${amount}` : amount < 0 ? `−${-amount}` : "0";
}

/** The right-hand amount: a buyer's SALE leaves the balance alone and shows
 * „zablokowane p → wydane”; every other row shows its signed balance change. */
export function pointsAmount(entry: PointHistoryEntry): { text: string; tone: "plus" | "minus" | "neutral" } {
  if (isPurchase(entry)) return { text: `zablokowane ${-entry.held_amount} → wydane`, tone: "neutral" };
  return { text: signedAmount(entry.amount), tone: entry.amount < 0 ? "minus" : "plus" };
}
