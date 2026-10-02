import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  getMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationResponse,
} from "../api/notifications";
import { extractProblemMessage } from "../api/problem";
import { useAuth } from "../auth/AuthContext";

interface UseNotificationsResult {
  data: NotificationResponse[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  markRead: (id: string) => void;
  markAllRead: () => Promise<void>;
}

export const NOTIFICATIONS_KEY = ["notifications"] as const;
const NO_NOTIFICATIONS: NotificationResponse[] = [];

/**
 * The logged-in user's in-app notifications, shared by the header bell
 * (`NotificationBell`) and the Panel's pending-actions modal (which derives
 * swap/confirm prompts from unread entries) — one cached query, so marking
 * an entry read in either place updates both. The username is part of the
 * key so a different account never sees the previous one's entries; the
 * query is disabled while logged out.
 */
export function useNotifications(): UseNotificationsResult {
  const queryClient = useQueryClient();
  const { token, username } = useAuth();
  const queryKey = [...NOTIFICATIONS_KEY, username] as const;
  const query = useQuery({ queryKey, queryFn: getMyNotifications, enabled: token !== null });
  const { refetch: queryRefetch } = query;

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  const setReadLocally = useCallback(
    (isTarget: (n: NotificationResponse) => boolean) => {
      const readAt = new Date().toISOString();
      queryClient.setQueriesData<NotificationResponse[]>({ queryKey: NOTIFICATIONS_KEY }, (prev) =>
        prev?.map((n) => (n.read_at === null && isTarget(n) ? { ...n, read_at: readAt } : n)),
      );
    },
    [queryClient],
  );

  // Optimistic and fire-and-forget: a failed mark-read only means the entry
  // shows as unread again after the next refetch.
  const markRead = useCallback(
    (id: string) => {
      setReadLocally((n) => n.id === id);
      void markNotificationRead(id).catch(() => undefined);
    },
    [setReadLocally],
  );

  const markAllRead = useCallback(async () => {
    setReadLocally(() => true);
    try {
      await markAllNotificationsRead();
    } catch {
      await queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
    }
  }, [queryClient, setReadLocally]);

  const data = query.data ?? NO_NOTIFICATIONS;
  return {
    data,
    unreadCount: data.filter((n) => n.read_at === null).length,
    loading: query.isPending,
    error: query.error ? extractProblemMessage(query.error) : null,
    refetch,
    markRead,
    markAllRead,
  };
}
