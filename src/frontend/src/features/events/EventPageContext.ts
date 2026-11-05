import { createContext, useContext } from "react";
import type { UseEventResult } from "../../hooks/useEvent";
import type { EventContentView } from "./eventViewState";

/** What every block of a loaded event page reads: the one content view
 * (blocks never re-derive it), the event's reads and writes and the viewer. */
export interface EventPageValue {
  view: EventContentView;
  actions: UseEventResult;
  isLoggedIn: boolean;
  showToast: (message: string) => void;
}

export const EventPageContext = createContext<EventPageValue | null>(null);

export function useEventPage(): EventPageValue {
  const value = useContext(EventPageContext);
  if (value === null) throw new Error("Event page blocks render only inside <EventPage>");
  return value;
}

/** A failed first read, thrown by `EventPage` to the route's `error.tsx`,
 * which shows its message (other errors get the generic copy). */
export class EventLoadError extends Error {}
