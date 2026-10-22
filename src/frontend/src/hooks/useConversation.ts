import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { hasStatus } from "../api/problem";
import { chatErrorMessage, getConversation, type ConversationResponse } from "../api/conversations";
import { useAuth } from "../auth/AuthContext";

const CONVERSATION_KEY = "conversation";

interface UseConversationResult {
  conversation: ConversationResponse | null;
  /** 404, or 400 for a malformed id in the URL. */
  notFound: boolean;
  /** 403: the caller is not a participant. */
  denied: boolean;
  loading: boolean;
  /** Any other failure. */
  error: string | null;
  refetch: () => Promise<void>;
}

/** The thread header: title, kind, read-only state and participant count. */
export function useConversation(id: string): UseConversationResult {
  const { username } = useAuth();
  const query = useQuery({
    queryKey: [CONVERSATION_KEY, username, id],
    queryFn: () => getConversation(id),
  });
  const { refetch: queryRefetch } = query;
  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  const notFound = hasStatus(query.error, 404) || hasStatus(query.error, 400);
  const denied = hasStatus(query.error, 403);
  return {
    conversation: query.data ?? null,
    notFound,
    denied,
    loading: query.isPending,
    error:
      query.error && !notFound && !denied
        ? chatErrorMessage(query.error, "Nie udało się wczytać wiadomości")
        : null,
    refetch,
  };
}
