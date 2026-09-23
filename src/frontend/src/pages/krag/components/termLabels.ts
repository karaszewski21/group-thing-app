import type { ReservationType } from "../../../api/reservations";

/** Offered `ReservationType`s a lister can pick when creating a new "Wystaw
 * rzecz" listing — `RETURN` is never offered here: it's for giving an
 * already-borrowed item back, not for a fresh Term listing. */
export const LISTABLE_RESERVATION_TYPES: ReservationType[] = ["LEND", "SWAP", "GIFT"];

export const OFFERED_TYPE_LABELS: Record<ReservationType, string> = {
  LEND: "Pożyczę",
  SWAP: "Zamienię",
  GIFT: "Oddam na stałe",
  RETURN: "Zwrot",
};

/** Labels for the "Rzeczy od innych" take buttons — per spec.md's Visual
 * Design section: "Pożycz" / "Zamień" / "Weź na stałe". */
export const TAKE_ACTION_LABELS: Record<ReservationType, string> = {
  LEND: "Pożycz",
  SWAP: "Zamień",
  GIFT: "Weź na stałe",
  RETURN: "Zwrot",
};
