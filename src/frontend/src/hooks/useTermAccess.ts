import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { getGroupAccess, type GroupAccessResponse } from "../api/groups";
import { useAuth } from "../auth/AuthContext";

export type TermAccessState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      data: GroupAccessResponse;
      /** The auth token the `data` was fetched with. */
      forToken: string | null;
      /** Set when a refetch after the first load failed; `data` is kept. */
      refreshError: string | null;
    };

interface UseTermAccessResult {
  state: TermAccessState;
  /** `data` was fetched for a different token than the current one (e.g.
   * right after an in-page login), and no newer response has arrived. */
  isStale: boolean;
  refetch: () => Promise<void>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Nie udało się wczytać danych grupy";
}

/** The term page's single data source: the Circle's public view plus the
 * caller's resolved access, from `getGroupAccess`. Re-fetches whenever the
 * auth token changes, so an in-page login (e.g. `AccountMergeForm`)
 * re-renders the page as that user. The token is deliberately NOT part of
 * the query key: a new key would drop the current data, while the page must
 * keep showing it (flagged `isStale`) until the new response arrives — and
 * keep it, with `refreshError`, if that fetch fails. Another (groupId,
 * termId) is a new key, so it behaves like a first load: `loading` until its
 * response, `error` if that fails. React Query cancels an in-flight fetch
 * when a new one starts, so the latest request always wins. */
export function useTermAccess(groupId: number, termId?: number): UseTermAccessResult {
  const { token } = useAuth();
  const query = useQuery({
    queryKey: ["groupAccess", groupId, termId ?? null],
    queryFn: async () => ({ data: await getGroupAccess(groupId, termId), forToken: token }),
  });
  const { refetch: queryRefetch } = query;

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  const lastToken = useRef(token);
  useEffect(() => {
    if (lastToken.current === token) return;
    lastToken.current = token;
    void queryRefetch();
  }, [token, queryRefetch]);

  let state: TermAccessState;
  if (query.data) {
    state = {
      status: "ready",
      data: query.data.data,
      forToken: query.data.forToken,
      refreshError: query.error ? errorMessage(query.error) : null,
    };
  } else if (query.error) {
    state = { status: "error", message: errorMessage(query.error) };
  } else {
    state = { status: "loading" };
  }
  const isStale = state.status === "ready" && state.forToken !== token;
  return { state, isStale, refetch };
}
