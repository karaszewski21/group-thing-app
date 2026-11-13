import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { extractProblemMessage, hasStatus } from "../api/problem";
import { shouldRetry } from "../api/queryClient";
import { searchPublic, type SearchQuery, type SearchResult } from "../api/search";
import { foldCategoryText } from "../utils/categoryTree";

export const SEARCH_KEY = "search";

const SEARCH_PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;
/** The backend's minimum: `len(fold_polish(q.strip())) >= 2`. */
export const SEARCH_MIN_LENGTH = 2;
/** The backend's maximum length of `q`. */
export const SEARCH_MAX_LENGTH = 100;
/** The backend's `MAX_SEARCH_PAGE`: a later page is a 400. */
export const SEARCH_MAX_PAGE = 50;

const NO_RESULTS: SearchResult[] = [];

/** `q` as the backend measures it: folded, trimmed, inner whitespace collapsed. */
export function isSearchTooShort(q: string): boolean {
  return foldCategoryText(q).trim().split(/\s+/).join(" ").length < SEARCH_MIN_LENGTH;
}

export interface UseSearchResult {
  items: SearchResult[];
  total: number;
  /** How many results the other mode has (from the first page). */
  otherModeCount: number;
  /** The typed `q` is under 2 characters: nothing is asked for. */
  tooShort: boolean;
  /** No page to show yet for the typed `q` (the debounce included). */
  loading: boolean;
  /** The shown results belong to an earlier `q` or filter set. */
  stale: boolean;
  /** A first-page failure; a later page's failure goes to `nextPageError`. */
  error: string | null;
  hasNextPage: boolean;
  fetchNextPage: () => Promise<void>;
  fetchingNextPage: boolean;
  nextPageError: string | null;
}

/** The global search, 20 results at a time. The typed `q` is debounced by
 * 300 ms and needs 2 characters; the previous results stay shown while a new
 * `q` or filter loads. `viewer` (the logged-in username, `null` for a guest)
 * keys the cache, so results personalised for one account never show for
 * another; a guest's scope `all` comes from `useSearchUrlState`. `enabled`
 * false (invalid filters) asks for nothing. */
export function useSearch(
  { q, mode, scope, filters }: SearchQuery,
  viewer: string | null,
  { enabled = true }: { enabled?: boolean } = {},
): UseSearchResult {
  const term = q.trim();
  const [debounced, setDebounced] = useState(term);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  const tooShort = isSearchTooShort(term);
  const request: SearchQuery = { q: debounced, mode, scope, filters };
  const query = useInfiniteQuery({
    queryKey: [SEARCH_KEY, { ...request, viewer }] as const,
    queryFn: ({ pageParam }) => searchPublic(request, pageParam, SEARCH_PAGE_SIZE),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.page < SEARCH_MAX_PAGE && last.page * last.size < last.total ? last.page + 1 : undefined,
    // A 503 is the backend's statement timeout: asking again reruns the same slow search.
    retry: (failureCount, error) => !hasStatus(error, 503) && shouldRetry(failureCount, error),
    // Another account's (or a guest's) results are never kept on screen.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1].viewer === viewer ? keepPreviousData(previous) : undefined,
    enabled: enabled && !isSearchTooShort(debounced),
  });
  const { fetchNextPage: fetchNextQueryPage } = query;
  const fetchNextPage = useCallback(async () => {
    await fetchNextQueryPage();
  }, [fetchNextQueryPage]);

  const items = useMemo(
    () => (query.data ? query.data.pages.flatMap((page) => page.items) : NO_RESULTS),
    [query.data],
  );
  const firstPage = query.data?.pages[0];
  return {
    items,
    total: firstPage?.total ?? 0,
    otherModeCount: firstPage?.other_mode_count ?? 0,
    tooShort,
    loading: !tooShort && query.isPending,
    stale: query.isPlaceholderData || debounced !== term,
    error: query.error && !query.isFetchNextPageError ? extractProblemMessage(query.error) : null,
    hasNextPage: query.hasNextPage,
    fetchNextPage,
    fetchingNextPage: query.isFetchingNextPage,
    nextPageError: query.isFetchNextPageError ? extractProblemMessage(query.error) : null,
  };
}
