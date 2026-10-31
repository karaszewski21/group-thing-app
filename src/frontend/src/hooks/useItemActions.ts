import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { getItemActions, type ItemActionsResponse } from "../api/itemActions";
import { extractProblemMessage } from "../api/problem";
import type { ItemContext } from "../pages/product/useItemRoutes";

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

/** The item page's actions card data for the `?term=`/`?event=` context. */
export function useItemActions(itemId: string, context: ItemContext | null): UseItemActionsResult {
  const query = useQuery({
    queryKey: [ITEM_ACTIONS_KEY, itemId, context],
    queryFn: () => getItemActions(itemId, context),
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
