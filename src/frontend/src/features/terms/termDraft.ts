import type { LocationRefResponse } from "../../api/locations";
import type { TermResponse } from "../../api/terms";
import { capacityText, priceText } from "../../utils/appHelpers";

/** The term fields of "Edytuj termin" and the first-term stepper, kept in
 * AppDataContext so a trip to /places/new from the place picker keeps them.
 * `capacity`, `price` and `paymentUrl` are the raw input texts
 * (`parseCapacity`, `parsePrice` and `parsePaymentUrl` read them).
 * `attendancePoints` is the level picked in "Edytuj termin", `null` until
 * picked; the first-term stepper shows no picker and leaves it `null`. */
export interface TermDraft {
  occursOn: string;
  description: string;
  locationId: string | null;
  capacity: string;
  price: string;
  paymentUrl: string;
  attendancePoints: number | null;
}

/** The price hint of the term create forms, which start from the circle's defaults. */
export const TERM_PAYMENT_PREFILL_HINT = "Cena i link podpowiedziane z ustawień kręgu — możesz je zmienić.";

/** `<input type="datetime-local">` wants `YYYY-MM-DDTHH:MM`; the API sends
 * seconds (and sometimes only a date). */
export const toLocalInput = (iso: string): string =>
  iso.length >= 16 ? iso.slice(0, 16) : `${iso.slice(0, 10)}T00:00`;

export function termEditDraftFrom(term: TermResponse): TermDraft {
  return {
    occursOn: toLocalInput(term.occurs_on),
    description: term.description ?? "",
    locationId: term.location?.id ?? null,
    capacity: capacityText(term.capacity),
    price: priceText(term.price),
    paymentUrl: term.payment_url ?? "",
    attendancePoints: null,
  };
}

/** A new term prefilled with its group's default place, capacity, price and payment link. */
export function newTermDraft(
  defaultLocation: LocationRefResponse | null,
  defaultCapacity: number | null,
  defaultPrice: string | null = null,
  defaultPaymentUrl: string | null = null,
): TermDraft {
  return {
    occursOn: "",
    description: "",
    locationId: defaultLocation?.id ?? null,
    capacity: capacityText(defaultCapacity),
    price: priceText(defaultPrice),
    paymentUrl: defaultPaymentUrl ?? "",
    attendancePoints: null,
  };
}
