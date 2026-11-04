import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import {
  deleteEvent,
  getEvent,
  signUpForEvent,
  updateEvent,
  withdrawFromEvent,
  type CreateEventRequest,
  type EventAttendanceResponse,
  type EventDetailResponse,
} from "../api/events";
import { ApiError } from "../api/client";
import { extractProblemMessage } from "../api/problem";
import { useAuth } from "../auth/AuthContext";
import { ATTENDING_EVENTS_KEY } from "./useAttendingEvents";
import { CONVERSATIONS_KEY } from "./useConversations";
import { MY_EVENTS_KEY } from "./useMyEvents";

interface UseEventResult {
  data: EventDetailResponse | null;
  loading: boolean;
  /** `data` was fetched for a different token than the current one (e.g.
   * right after an in-page login or a logout), and no newer response has
   * arrived. */
  isStale: boolean;
  notFound: boolean;
  error: string | null;
  /** Set when a refetch after the first load failed; `data` is kept. */
  refreshError: string | null;
  refetch: () => Promise<void>;
  update: (request: CreateEventRequest) => Promise<void>;
  remove: () => Promise<void>;
  signUp: () => Promise<EventAttendanceResponse>;
  withdraw: () => Promise<void>;
}

export const EVENT_KEY = "event";

/** One event's page. `is_author`, `is_attending` and `is_me` depend on who
 * asks, yet the token is deliberately NOT part of the key: a new key would
 * drop the page on screen, while it must stay (flagged `isStale`) until the
 * response for the new token arrives — and stay, with `refreshError`, if
 * that fetch fails. The query result is tagged with the token it was
 * fetched for, and a token change triggers a refetch. Writes refresh this
 * event and the caller's event lists. */
export function useEvent(eventId: string): UseEventResult {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [EVENT_KEY, eventId],
    queryFn: async () => ({ data: await getEvent(eventId), forToken: token }),
    enabled: eventId !== "",
  });
  const { refetch: queryRefetch } = query;

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  const lastToken = useRef(token);
  useEffect(() => {
    if (lastToken.current === token) return;
    lastToken.current = token;
    void queryRefetch();
  }, [token, queryRefetch]);

  const update = useCallback(
    async (request: CreateEventRequest) => {
      try {
        await updateEvent(eventId, request);
      } catch (err) {
        throw new Error(extractProblemMessage(err));
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [EVENT_KEY] }),
        queryClient.invalidateQueries({ queryKey: [MY_EVENTS_KEY] }),
      ]);
    },
    [eventId, queryClient],
  );

  const remove = useCallback(async () => {
    try {
      await deleteEvent(eventId);
    } catch (err) {
      throw new Error(extractProblemMessage(err));
    }
    queryClient.removeQueries({ queryKey: [EVENT_KEY, eventId] });
    // The deleted event's chat leaves the inbox.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [MY_EVENTS_KEY] }),
      queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY }),
    ]);
  }, [eventId, queryClient]);

  const signUp = useCallback(
    async () => {
      let attendance: EventAttendanceResponse;
      try {
        attendance = await signUpForEvent(eventId);
      } catch (err) {
        throw new Error(extractProblemMessage(err));
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [EVENT_KEY] }),
        queryClient.invalidateQueries({ queryKey: [MY_EVENTS_KEY] }),
        queryClient.invalidateQueries({ queryKey: [ATTENDING_EVENTS_KEY] }),
      ]);
      return attendance;
    },
    [eventId, queryClient],
  );

  /** The event chat leaves the caller's inbox, so the conversations refresh too. */
  const withdraw = useCallback(async () => {
    try {
      await withdrawFromEvent(eventId);
    } catch (err) {
      throw new Error(extractProblemMessage(err));
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [EVENT_KEY] }),
      queryClient.invalidateQueries({ queryKey: [MY_EVENTS_KEY] }),
      queryClient.invalidateQueries({ queryKey: [ATTENDING_EVENTS_KEY] }),
      queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY }),
    ]);
  }, [eventId, queryClient]);

  const notFound = query.error instanceof ApiError && query.error.status === 404;
  const error = query.error && !notFound ? extractProblemMessage(query.error) : null;
  return {
    data: query.data?.data ?? null,
    loading: query.isPending,
    isStale: query.data !== undefined && query.data.forToken !== token,
    notFound,
    error,
    refreshError: query.data ? error : null,
    refetch,
    update,
    remove,
    signUp,
    withdraw,
  };
}
