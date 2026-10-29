import type { EventDetailResponse } from "../../api/events";

export type EventViewState =
  | { kind: "loading" }
  | { kind: "notFound" }
  | { kind: "error"; message: string }
  | { kind: "content"; event: EventDetailResponse };

interface EventQueryState {
  data: EventDetailResponse | null;
  loading: boolean;
  notFound: boolean;
  error: string | null;
}

/** The one screen the event page shows. A failed refresh keeps the event
 * already on screen; a 404 always wins (the event was deleted). */
export function resolveEventView({ data, loading, notFound, error }: EventQueryState): EventViewState {
  if (notFound) return { kind: "notFound" };
  if (data) return { kind: "content", event: data };
  if (error) return { kind: "error", message: error };
  if (loading) return { kind: "loading" };
  return { kind: "notFound" };
}
