import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { getMyOrganization, type MyOrganizationResponse } from "../api/organizations";
import { extractProblemMessage, hasStatus } from "../api/problem";
import { useAuth } from "../auth/AuthContext";
import { isAwaitingModeration, mediaStatusChanged, PENDING_MEDIA_POLL_MS } from "./mediaModeration";
import { PUBLIC_ORGANIZATION_KEY } from "./usePublicOrganization";

export const MY_ORGANIZATION_KEY = "myOrganization";

interface UseMyOrganizationOptions {
  /** Poll while any media row is PENDING or NEEDS_REVIEW. Only the mounted
   * photos tab turns this on: the same query backs the panel and nav. */
  pollPendingMedia?: boolean;
}

interface UseMyOrganizationResult {
  data: MyOrganizationResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** The logged-in caller's own Organization, or `null` when they have none
 * yet (the endpoint 404s, which is not an error) or nobody is logged in.
 * The token is part of the key: another account's organization must never
 * show, even briefly. With `pollPendingMedia`, it re-reads every 10 s while
 * media awaits moderation, and a re-read that changes a media status
 * invalidates the public organization so the page behind the editor updates. */
export function useMyOrganization({ pollPendingMedia = false }: UseMyOrganizationOptions = {}): UseMyOrganizationResult {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [MY_ORGANIZATION_KEY, token],
    queryFn: getMyOrganization,
    enabled: token !== null,
    refetchInterval: (q) =>
      pollPendingMedia && q.state.data?.media?.some(isAwaitingModeration) ? PENDING_MEDIA_POLL_MS : false,
  });
  const { refetch: refetchQuery } = query;
  const refetch = useCallback(async () => {
    await refetchQuery();
  }, [refetchQuery]);

  const media = query.data?.media;
  const previousMedia = useRef(media);
  useEffect(() => {
    const previous = previousMedia.current;
    previousMedia.current = media;
    if (pollPendingMedia && previous && media && mediaStatusChanged(previous, media)) {
      void queryClient.invalidateQueries({ queryKey: [PUBLIC_ORGANIZATION_KEY] });
    }
  }, [media, pollPendingMedia, queryClient]);

  return {
    data: query.data ?? null,
    loading: token !== null && query.isPending,
    error: query.error && !hasStatus(query.error, 404) ? extractProblemMessage(query.error) : null,
    refetch,
  };
}
