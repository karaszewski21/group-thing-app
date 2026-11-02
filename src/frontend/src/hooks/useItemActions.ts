import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { getItemActions, type ItemActionsResponse } from "../api/itemActions";
import { extractProblemMessage } from "../api/problem";
import { useAuth } from "../auth/AuthContext";

/** Takes and swap proposals (`useItemTake`) invalidate this prefix. */
export const ITEM_ACTIONS_KEY = "item-actions";

export interface UseItemActionsResult {
  data: ItemActionsResponse | null;
  loading: boolean;
  /** Any fetch in flight, background refetches included. */
  fetching: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** The item page's actions card data. The response is personalised, so the
 * viewer's user id is part of the key: a login, logout or account switch
 * fetches afresh instead of showing another viewer's cached data. */
export function useItemActions(itemId: string): UseItemActionsResult {
  const { username: viewerUserId } = useAuth();
  const query = useQuery({
    queryKey: [ITEM_ACTIONS_KEY, itemId, viewerUserId ?? null],
    queryFn: () => getItemActions(itemId),
  });
  const { refetch: refetchQuery } = query;
  const refetch = useCallback(async () => {
    await refetchQuery();
  }, [refetchQuery]);

  return {
    data: query.data ?? null,
    loading: query.isPending,
    fetching: query.isFetching,
    error: query.error ? extractProblemMessage(query.error) : null,
    refetch,
  };
}
