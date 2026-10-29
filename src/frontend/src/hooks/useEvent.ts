import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { deleteEvent, getEvent, updateEvent, type CreateEventRequest, type EventDetailResponse } from "../api/events";
import { ApiError } from "../api/client";
import { extractProblemMessage } from "../api/problem";
import { useAuth } from "../auth/AuthContext";
import { MY_EVENTS_KEY } from "./useMyEvents";

interface UseEventResult {
  data: EventDetailResponse | null;
  loading: boolean;
  notFound: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  update: (request: CreateEventRequest) => Promise<void>;
  remove: () => Promise<void>;
}

export const EVENT_KEY = "event";

/** One event's page. The token is part of the key: `is_author` depends on
 * who asks. Writes refresh this event and the caller's event list. */
export function useEvent(eventId: string): UseEventResult {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [EVENT_KEY, eventId, token],
    queryFn: () => getEvent(eventId),
    enabled: eventId !== "",
  });
  const { refetch: queryRefetch } = query;

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

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
    await queryClient.invalidateQueries({ queryKey: [MY_EVENTS_KEY] });
  }, [eventId, queryClient]);

  const notFound = query.error instanceof ApiError && query.error.status === 404;
  return {
    data: query.data ?? null,
    loading: query.isPending,
    notFound,
    error: query.error && !notFound ? extractProblemMessage(query.error) : null,
    refetch,
    update,
    remove,
  };
}
