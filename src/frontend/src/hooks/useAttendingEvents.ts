import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { getAttendingEvents, type EventResponse } from "../api/events";
import { extractProblemMessage } from "../api/problem";
import { useAuth } from "../auth/AuthContext";

interface UseAttendingEventsResult {
  data: EventResponse[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export const ATTENDING_EVENTS_KEY = "attendingEvents";
const NO_EVENTS: EventResponse[] = [];

/** The events the caller signed up for, listed under "Biorę udział" on
 * `/meetings`. The token is part of the key, so another account's sign-ups
 * never show. */
export function useAttendingEvents(): UseAttendingEventsResult {
  const { token } = useAuth();
  const query = useQuery({
    queryKey: [ATTENDING_EVENTS_KEY, token],
    queryFn: getAttendingEvents,
    enabled: token !== null,
  });
  const { refetch: queryRefetch } = query;

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  return {
    data: query.data ?? NO_EVENTS,
    loading: query.isPending && token !== null,
    error: query.error ? extractProblemMessage(query.error) : null,
    refetch,
  };
}
