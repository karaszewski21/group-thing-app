import type { LocationRefResponse } from "../../api/locations";
import type { TermResponse } from "../../api/terms";
import { capacityText } from "../../utils/appHelpers";

/** The term fields of "Edytuj termin" and the first-term stepper, kept in
 * AppDataContext so a trip to /places/new from the place picker keeps them.
 * `capacity` is the raw input text (`parseCapacity` reads it). */
export interface TermDraft {
  occursOn: string;
  description: string;
  locationId: string | null;
  capacity: string;
}

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
  };
}

/** A new term prefilled with its group's default place and capacity. */
export function newTermDraft(
  defaultLocation: LocationRefResponse | null,
  defaultCapacity: number | null,
): TermDraft {
  return {
    occursOn: "",
    description: "",
    locationId: defaultLocation?.id ?? null,
    capacity: capacityText(defaultCapacity),
  };
}
