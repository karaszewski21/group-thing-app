import type { ExchangeMode } from "../../../api/groups";
import type { ReservationType } from "../../../api/reservations";

/** `ReservationType`s an item listing can offer — `RETURN` is for giving an
 * already-borrowed item back, never a listing mode. */
export const LISTABLE_RESERVATION_TYPES: ReservationType[] = ["LEND", "SWAP", "GIFT"];

/** Take-button labels on an attendee's offered items. */
export const TAKE_ACTION_LABELS: Record<ReservationType, string> = {
  LEND: "Pożycz",
  SWAP: "Zamień",
  GIFT: "Weź na stałe",
  RETURN: "Zwrot",
};

/** Exchange directory labels per listing mode (organizer public page). */
export const EXCHANGE_MODE_LABELS: Record<ExchangeMode, string> = {
  GIFT: "Oddam",
  SWAP: "Zamienię",
  LEND: "Wypożyczę",
};

/** Soft background plus a readable foreground per exchange mode. */
export const EXCHANGE_MODE_TONE: Record<ExchangeMode, string> = {
  GIFT: "bg-primary-soft text-primary-fg",
  SWAP: "bg-accent-soft text-accent-fg",
  LEND: "bg-teal-soft text-ink",
};
