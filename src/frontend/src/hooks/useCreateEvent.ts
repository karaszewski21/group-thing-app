import { useCallback, useMemo } from "react";
import {
  createEvent,
  uploadEventBanner,
  type CreateEventRequest,
  type EventBannerResponse,
  type EventResponse,
} from "../api/events";
import { serverMessageOr } from "../api/problem";

const CREATE_FALLBACK = "Nie udało się zapisać wydarzenia. Spróbuj ponownie.";
const BANNER_FALLBACK = "Nie udało się wysłać banera.";

/** Creates an event, then (separately, since the event must exist first)
 * uploads its banner. Errors are rethrown as Polish messages — the server's
 * own text for domain rules. No query caches events, so nothing is
 * invalidated; a place added on the way goes through `useMyLocations`. */
export function useCreateEvent() {
  const create = useCallback(async (request: CreateEventRequest): Promise<EventResponse> => {
    try {
      return await createEvent(request);
    } catch (err) {
      throw new Error(serverMessageOr(err, CREATE_FALLBACK));
    }
  }, []);

  const uploadBanner = useCallback(async (eventId: string, file: File): Promise<EventBannerResponse> => {
    try {
      return await uploadEventBanner(eventId, file);
    } catch (err) {
      throw new Error(serverMessageOr(err, BANNER_FALLBACK));
    }
  }, []);

  return useMemo(() => ({ create, uploadBanner }), [create, uploadBanner]);
}
