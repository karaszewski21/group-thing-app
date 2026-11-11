import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getMyInventoryItemsPage,
  type MyInventoryItemCounts,
  type MyInventoryItemResponse,
  type MyItemsModeFilter,
} from "../api/inventories";
import { extractProblemMessage } from "../api/problem";

export const MY_ITEMS_PAGE_KEY = "myItemsPage";

const MY_ITEMS_PAGE_SIZE = 5;
const SEARCH_DEBOUNCE_MS = 300;

const NO_ITEMS: MyInventoryItemResponse[] = [];
const NO_COUNTS: MyInventoryItemCounts = { ALL: 0, GIFT: 0, SWAP: 0 };

export interface UseMyItemsPageResult {
  items: MyInventoryItemResponse[];
  counts: MyInventoryItemCounts;
  loading: boolean;
  /** A first-page failure; a later page's failure goes to `nextPageError`. */
  error: string | null;
  hasNextPage: boolean;
  fetchNextPage: () => Promise<void>;
  fetchingNextPage: boolean;
  nextPageError: string | null;
}

/** "Moje rzeczy" five at a time, newest first. The typed `q` is debounced by
 * 300 ms; the previous list stays shown while a new filter loads. */
export function useMyItemsPage(mode: MyItemsModeFilter | null, q: string): UseMyItemsPageResult {
  const term = q.trim();
  const [debounced, setDebounced] = useState(term);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  const query = useInfiniteQuery({
    queryKey: [MY_ITEMS_PAGE_KEY, { mode, q: debounced }],
    queryFn: ({ pageParam }) => getMyInventoryItemsPage({ mode, q: debounced }, pageParam, MY_ITEMS_PAGE_SIZE),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.size < last.total ? last.page + 1 : undefined),
    placeholderData: keepPreviousData,
  });
  const { fetchNextPage: fetchNextQueryPage } = query;
  const fetchNextPage = useCallback(async () => {
    await fetchNextQueryPage();
  }, [fetchNextQueryPage]);

  const items = useMemo(
    () => (query.data ? query.data.pages.flatMap((page) => page.items) : NO_ITEMS),
    [query.data],
  );
  return {
    items,
    counts: query.data?.pages[0]?.counts ?? NO_COUNTS,
    loading: query.isPending,
    error: query.error && !query.isFetchNextPageError ? extractProblemMessage(query.error) : null,
    hasNextPage: query.hasNextPage,
    fetchNextPage,
    fetchingNextPage: query.isFetchingNextPage,
    nextPageError: query.isFetchNextPageError ? extractProblemMessage(query.error) : null,
  };
}
