import type { EventDetailResponse } from "../../api/events";

export type EventViewState =
  | { kind: "loading" }
  | { kind: "notFound" }
  | { kind: "error"; message: string }
  /** Data fetched for a different token (in-page login/merge, or logout):
   * read-only sections only, until the refetch lands or fails (`error`). */
  | { kind: "refreshing"; event: EventDetailResponse; error: string | null }
  | { kind: "author"; event: EventDetailResponse }
  | { kind: "attendee"; event: EventDetailResponse; ended: boolean }
  | { kind: "guestAttendee"; event: EventDetailResponse; guestProfileId: string }
  | { kind: "visitor"; event: EventDetailResponse; ended: boolean; isLoggedIn: boolean };

/** The views that show the event itself. */
export type EventContentView = Extract<EventViewState, { event: EventDetailResponse }>;

interface EventPageState {
  data: EventDetailResponse | null;
  loading: boolean;
  notFound: boolean;
  error: string | null;
  isStale: boolean;
  isLoggedIn: boolean;
  /** The anonymous visitor's stored guest sign-up for this event, if valid. */
  guestProfileId: string | null;
}

/** The one screen the event page shows. A 404 always wins (the event was
 * deleted); stale data is shown read-only; otherwise a failed refresh keeps
 * the event already on screen. */
export function resolveEventView({
  data,
  loading,
  notFound,
  error,
  isStale,
  isLoggedIn,
  guestProfileId,
}: EventPageState): EventViewState {
  if (notFound) return { kind: "notFound" };
  if (data) {
    if (isStale) return { kind: "refreshing", event: data, error };
    if (data.is_author) return { kind: "author", event: data };
    if (data.is_attending) return { kind: "attendee", event: data, ended: data.has_ended };
    if (!isLoggedIn && guestProfileId !== null) return { kind: "guestAttendee", event: data, guestProfileId };
    return { kind: "visitor", event: data, ended: data.has_ended, isLoggedIn };
  }
  if (error) return { kind: "error", message: error };
  if (loading) return { kind: "loading" };
  return { kind: "notFound" };
}
