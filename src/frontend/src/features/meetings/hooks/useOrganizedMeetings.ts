import type { EventResponse } from "../../../api/events";
import type { MyTermResponse, NeededItemResponse } from "../../../api/terms";
import { useMyEvents } from "../../../hooks/useMyEvents";
import { useMyTerms, type UseMyTermsResult } from "../../../hooks/useMyTerms";
import { useNeededItems } from "../../../hooks/useNeededItems";
import { mergeLatestFirst } from "../meetingsList";

export interface OrganizedMeetings {
  /** Led terms and own events, latest date first. */
  entries: (MyTermResponse | EventResponse)[];
  paged: UseMyTermsResult;
  neededItems: ReadonlyMap<string, NeededItemResponse[]>;
  /** Until both the first terms page and the events are in. */
  loading: boolean;
  error: string | null;
}

/** "Organizujesz": the terms of the circles the caller leads, page by page,
 * merged with the events they created, plus those terms' needs. */
export function useOrganizedMeetings(): OrganizedMeetings {
  const led = useMyTerms("led");
  const events = useMyEvents();
  const { data: neededItems } = useNeededItems(led.terms.map((term) => term.id));

  return {
    entries: mergeLatestFirst<MyTermResponse | EventResponse>(led, led.terms, events.data),
    paged: led,
    neededItems,
    loading: led.loading || events.loading,
    error: led.error ?? events.error,
  };
}
