import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { getMyEvents, type EventResponse } from "../api/events";
import { extractProblemMessage } from "../api/problem";
import { useAuth } from "../auth/AuthContext";

interface UseMyEventsResult {
  data: EventResponse[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export const MY_EVENTS_KEY = "myEvents";
const NO_EVENTS: EventResponse[] = [];

/** The events the caller created, listed next to their group terms on
 * `/meetings`. The token is part of the key, so another account's events
 * never show. */
export function useMyEvents(): UseMyEventsResult {
  const { token } = useAuth();
  const query = useQuery({
    queryKey: [MY_EVENTS_KEY, token],
    queryFn: getMyEvents,
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
