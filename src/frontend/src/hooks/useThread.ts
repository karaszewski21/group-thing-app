import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import {
  chatErrorMessage,
  getMessages,
  markConversationRead,
  postMessage,
  type MessageResponse,
} from "../api/conversations";
import { hasStatus } from "../api/problem";
import { useAuth } from "../auth/AuthContext";
import { CONVERSATIONS_KEY } from "./useConversations";
import { UNREAD_MESSAGES_KEY } from "./useUnreadMessages";

const THREAD_KEY = "thread";
const THREAD_POLL_MS = 5_000;
/** Pages one poll may read while catching up after a hidden-tab pause. */
const POLL_MAX_PAGES = 5;
const LIST_FALLBACK = "Nie udało się wczytać wiadomości";
const SEND_FALLBACK = "Nie udało się wysłać — spróbuj ponownie";

const NO_MESSAGES: MessageResponse[] = [];

/** Malformed id, no access or no such conversation: polling cannot recover. */
function isFinalError(err: unknown): boolean {
  return hasStatus(err, 400) || hasStatus(err, 403) || hasStatus(err, 404);
}

interface ThreadData {
  items: MessageResponse[];
  hasOlder: boolean;
  /** Newest id a newest-page or `after=` fetch returned. Own sends never move
   * it: a message committed just before mine (but after the last poll) sorts
   * before mine, so polling after mine would skip it forever. */
  cursor: string | null;
}

interface UseThreadResult {
  items: MessageResponse[];
  hasOlder: boolean;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  loadOlder: () => Promise<void>;
  loadingOlder: boolean;
  send: (body: string) => Promise<void>;
  markRead: (messageId: string) => Promise<void>;
}

/** Union by id, ascending by `(created_at, id)`. The timestamps share one
 * ISO format, so string order is time order. */
function mergeMessages(a: MessageResponse[], b: MessageResponse[]): MessageResponse[] {
  const byId = new Map<string, MessageResponse>();
  for (const m of [...a, ...b]) byId.set(m.id, m);
  return [...byId.values()].sort((x, y) =>
    x.created_at === y.created_at ? x.id.localeCompare(y.id) : x.created_at < y.created_at ? -1 : 1,
  );
}

/** One conversation's messages, as a single cached list. The first load
 * (or a thread with nothing fetched yet) reads the newest page; every 5 s
 * poll after that asks only for messages after the server cursor (paging
 * on while `has_more`, up to 5 pages) and merges them into the cache as it
 * is *after* the request, so pages added meanwhile by `loadOlder` or `send`
 * are kept. Polling stops on a 400/403/404 or when the caller passes
 * `poll: false`. */
export function useThread(id: string, { poll = true }: { poll?: boolean } = {}): UseThreadResult {
  const queryClient = useQueryClient();
  const { username } = useAuth();
  const [loadingOlder, setLoadingOlder] = useState(false);

  const query = useQuery({
    queryKey: [THREAD_KEY, username, id],
    queryFn: async (): Promise<ThreadData> => {
      const key = [THREAD_KEY, username, id];
      const cached = queryClient.getQueryData<ThreadData>(key);
      if (!cached?.cursor) {
        const page = await getMessages(id);
        const current = queryClient.getQueryData<ThreadData>(key);
        return {
          items: mergeMessages(current?.items ?? NO_MESSAGES, page.items),
          hasOlder: page.has_more,
          cursor: page.items.at(-1)?.id ?? null,
        };
      }
      let cursor = cached.cursor;
      let fetched: MessageResponse[] = [];
      for (let i = 0; i < POLL_MAX_PAGES; i++) {
        const page = await getMessages(id, { after: cursor });
        fetched = [...fetched, ...page.items];
        cursor = page.items.at(-1)?.id ?? cursor;
        if (!page.has_more || page.items.length === 0) break;
      }
      const current = queryClient.getQueryData<ThreadData>(key) ?? cached;
      return { items: mergeMessages(current.items, fetched), hasOlder: current.hasOlder, cursor };
    },
    refetchInterval: (q) => (poll && !isFinalError(q.state.error) ? THREAD_POLL_MS : false),
    refetchIntervalInBackground: false,
  });
  const { refetch: queryRefetch } = query;
  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  const loadOlder = useCallback(async () => {
    const key = [THREAD_KEY, username, id];
    const first = queryClient.getQueryData<ThreadData>(key)?.items[0];
    if (!first) return;
    setLoadingOlder(true);
    try {
      const page = await getMessages(id, { before: first.id });
      queryClient.setQueryData<ThreadData>(key, (prev) => ({
        items: mergeMessages(page.items, prev?.items ?? NO_MESSAGES),
        hasOlder: page.has_more,
        cursor: prev?.cursor ?? null,
      }));
    } catch (err) {
      throw new Error(chatErrorMessage(err, LIST_FALLBACK));
    } finally {
      setLoadingOlder(false);
    }
  }, [queryClient, username, id]);

  const send = useCallback(
    async (body: string) => {
      let sent: MessageResponse;
      try {
        sent = await postMessage(id, body);
      } catch (err) {
        throw new Error(chatErrorMessage(err, SEND_FALLBACK));
      }
      queryClient.setQueryData<ThreadData>([THREAD_KEY, username, id], (prev) => ({
        items: mergeMessages(prev?.items ?? NO_MESSAGES, [sent]),
        hasOlder: prev?.hasOlder ?? false,
        cursor: prev?.cursor ?? null,
      }));
      await queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY });
    },
    [queryClient, username, id],
  );

  const markRead = useCallback(
    async (messageId: string) => {
      await markConversationRead(id, messageId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: UNREAD_MESSAGES_KEY }),
        queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY }),
      ]);
    },
    [queryClient, id],
  );

  return {
    items: query.data?.items ?? NO_MESSAGES,
    hasOlder: query.data?.hasOlder ?? false,
    loading: query.isPending,
    error: query.error ? chatErrorMessage(query.error, LIST_FALLBACK) : null,
    refetch,
    loadOlder,
    loadingOlder,
    send,
    markRead,
  };
}
