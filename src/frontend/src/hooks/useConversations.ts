import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { chatErrorMessage, getConversations, type InboxRow } from "../api/conversations";
import { useAuth } from "../auth/AuthContext";

export const CONVERSATIONS_KEY = ["conversations"] as const;

/** Same cadence as the unread badge, so an open inbox shows what it counts. */
const INBOX_POLL_MS = 20_000;

const NO_CONVERSATIONS: InboxRow[] = [];

interface UseConversationsResult {
  data: InboxRow[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** The inbox: conversations with at least one message, newest first. Polls
 * every 20 s, only while the tab is visible. */
export function useConversations(): UseConversationsResult {
  const { token, username } = useAuth();
  const query = useQuery({
    queryKey: [...CONVERSATIONS_KEY, username],
    queryFn: getConversations,
    enabled: token !== null,
    refetchInterval: INBOX_POLL_MS,
    refetchIntervalInBackground: false,
  });
  const { refetch: queryRefetch } = query;
  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  return {
    data: query.data ?? NO_CONVERSATIONS,
    loading: query.isPending,
    error: query.error ? chatErrorMessage(query.error, "Nie udało się wczytać wiadomości") : null,
    refetch,
  };
}
