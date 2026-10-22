import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { chatErrorMessage, getUnreadMessageCount } from "../api/conversations";
import { useAuth } from "../auth/AuthContext";

export const UNREAD_MESSAGES_KEY = ["unreadMessages"] as const;

const UNREAD_POLL_MS = 20_000;

interface UseUnreadMessagesResult {
  count: number;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** Unread chat messages for the header badge. Polls every 20 s, only while
 * the tab is visible; disabled while logged out. The username is in the key
 * so another account never sees the previous one's count. */
export function useUnreadMessages(): UseUnreadMessagesResult {
  const { token, username } = useAuth();
  const query = useQuery({
    queryKey: [...UNREAD_MESSAGES_KEY, username],
    queryFn: getUnreadMessageCount,
    enabled: token !== null,
    refetchInterval: UNREAD_POLL_MS,
    refetchIntervalInBackground: false,
  });
  const { refetch: queryRefetch } = query;
  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  return {
    count: query.data?.count ?? 0,
    loading: query.isPending,
    error: query.error ? chatErrorMessage(query.error, "Nie udało się wczytać wiadomości") : null,
    refetch,
  };
}
