import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { getMyProfile, type UserProfileResponse } from "../api/people";
import { extractProblemMessage } from "../api/problem";
import { useAuth } from "../auth/AuthContext";
import { isAwaitingModeration, mediaStatusChanged, PENDING_MEDIA_POLL_MS } from "./mediaModeration";
import { OWNER_ITEMS_KEY } from "./useOwnerItems";

export const MY_PROFILE_KEY = "myProfile";

interface UseMyProfileOptions {
  /** Poll while any media row is PENDING or NEEDS_REVIEW (the mounted photos tab). */
  pollPendingMedia?: boolean;
}

interface UseMyProfileResult {
  data: UserProfileResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** The logged-in caller's own profile with their media, `null` when nobody
 * is logged in. The token is part of the key, so another account's profile
 * never shows. With `pollPendingMedia` it re-reads every 10 s while media
 * awaits moderation, and a status change refreshes the public profile. */
export function useMyProfile({ pollPendingMedia = false }: UseMyProfileOptions = {}): UseMyProfileResult {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [MY_PROFILE_KEY, token],
    queryFn: getMyProfile,
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
      void queryClient.invalidateQueries({ queryKey: [OWNER_ITEMS_KEY] });
    }
  }, [media, pollPendingMedia, queryClient]);

  return {
    data: query.data ?? null,
    loading: token !== null && query.isPending,
    error: query.error ? extractProblemMessage(query.error) : null,
    refetch,
  };
}
