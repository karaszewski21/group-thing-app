import type { EventResponse } from "../../api/events";
import type { MyTermResponse } from "../../api/terms";
import type { UseMyTermsResult } from "../../hooks/useMyTerms";
import { circleTermPath, type GuestTermCard } from "../../utils/appHelpers";

/** A led term, an event or a guest card — whatever a `/meetings` row is built from. */
export type ListedTerm = MyTermResponse | EventResponse | GuestTermCard;

export const listedTermId = (entry: ListedTerm) => ("termId" in entry ? entry.termId : entry.id);

const occursOnOf = (entry: ListedTerm) =>
  "termId" in entry ? entry.occursOn : "starts_at" in entry ? entry.starts_at : entry.occurs_on;

const latestFirst = (a: ListedTerm, b: ListedTerm) => occursOnOf(b).localeCompare(occursOnOf(a));

/** The server's term pages (latest date first) joined with entries the panel
 * has in full (events, RSVPs, pledges). While more pages exist, those show
 * only down to the last loaded term's date, so the list never skips a term
 * that is not loaded yet. */
export function mergeLatestFirst<T extends ListedTerm>(
  paged: Pick<UseMyTermsResult, "hasNextPage">,
  pagedEntries: T[],
  known: T[],
): T[] {
  const last = pagedEntries.at(-1);
  const shown = paged.hasNextPage && last ? known.filter((entry) => occursOnOf(entry) >= occursOnOf(last)) : known;
  return [...pagedEntries, ...shown].sort(latestFirst);
}

/** A member circle's term as a "Biorę udział" card. */
export function memberTermCard(term: MyTermResponse): GuestTermCard {
  return {
    termId: term.id,
    occursOn: term.occurs_on,
    groupName: term.group_name,
    description: term.description,
    href: circleTermPath(term.organizer_slug, term.group_id, term.id),
    location: term.location,
    capacity: term.capacity,
    attendeeCount: null,
  };
}
