import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { extractProblemMessage } from "../api/problem";
import { getNeededItemsForTerms, type NeededItemResponse } from "../api/terms";

interface UseNeededItemsResult {
  /** The needs of each requested term, by term id; a term without needs is absent. */
  data: ReadonlyMap<string, NeededItemResponse[]>;
  loading: boolean;
  error: string | null;
  /** Re-reads every needed-items query (the whole prefix), e.g. after a
   * need was added, edited, removed or (un)claimed. */
  refetch: () => Promise<void>;
}

export const NEEDED_ITEMS_KEY = "neededItems";
const NO_NEEDED_ITEMS: ReadonlyMap<string, NeededItemResponse[]> = new Map();

/** The needed items of `termIds`, read in one batched request. The ids are
 * sorted for the key, so the same set of terms shares one cache entry. While
 * a changed set (e.g. a list's next page) loads, the previous set's needs stay
 * shown, so the loaded cards' chips do not blink out. */
export function useNeededItems(termIds: readonly string[]): UseNeededItemsResult {
  const queryClient = useQueryClient();
  const ids = useMemo(() => [...new Set(termIds)].sort(), [termIds]);
  const query = useQuery({
    queryKey: [NEEDED_ITEMS_KEY, ids],
    queryFn: () => getNeededItemsForTerms(ids),
    enabled: ids.length > 0,
    placeholderData: keepPreviousData,
  });

  const byTerm = useMemo(() => {
    if (!query.data) return NO_NEEDED_ITEMS;
    const map = new Map<string, NeededItemResponse[]>();
    for (const item of query.data) map.set(item.term_id, [...(map.get(item.term_id) ?? []), item]);
    return map;
  }, [query.data]);

  const refetch = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: [NEEDED_ITEMS_KEY] });
  }, [queryClient]);

  return {
    data: byTerm,
    loading: query.isPending && ids.length > 0,
    error: query.error ? extractProblemMessage(query.error) : null,
    refetch,
  };
}
