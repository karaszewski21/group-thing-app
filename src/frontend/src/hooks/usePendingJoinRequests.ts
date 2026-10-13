import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { listMyPendingJoinRequests, type PendingJoinRequestResponse } from "../api/groups";
import { extractProblemMessage } from "../api/problem";
import { useAuth } from "../auth/AuthContext";

export const PENDING_JOIN_REQUESTS_KEY = "pendingJoinRequests";
const NO_JOIN_REQUESTS: PendingJoinRequestResponse[] = [];

interface UsePendingJoinRequestsResult {
  data: PendingJoinRequestResponse[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** PENDING requests to join the groups the logged-in user organizes, oldest
 * first. Keyed by username so another account never sees them; disabled
 * while logged out. */
export function usePendingJoinRequests(): UsePendingJoinRequestsResult {
  const { token, username } = useAuth();
  const query = useQuery({
    queryKey: [PENDING_JOIN_REQUESTS_KEY, username],
    queryFn: listMyPendingJoinRequests,
    enabled: token !== null,
  });
  const { refetch: queryRefetch } = query;

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  return {
    data: query.data ?? NO_JOIN_REQUESTS,
    loading: query.isPending,
    error: query.error ? extractProblemMessage(query.error) : null,
    refetch,
  };
}
