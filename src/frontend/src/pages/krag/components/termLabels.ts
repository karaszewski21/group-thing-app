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
