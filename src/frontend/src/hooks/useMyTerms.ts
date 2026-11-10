import { useInfiniteQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { extractProblemMessage } from "../api/problem";
import { getMyTerms, type MyTermResponse, type MyTermRole } from "../api/terms";

export const MY_TERMS_KEY = "myTerms";

// TEMPORARY: 5 to try infinite scroll by hand; set back to 20 (PAGE_SIZE).
const MY_TERMS_PAGE_SIZE = 5;

const NO_TERMS: MyTermResponse[] = [];

export interface UseMyTermsResult {
  terms: MyTermResponse[];
  total: number;
  loading: boolean;
  /** A first-page failure; a later page's failure goes to `nextPageError`. */
  error: string | null;
  hasNextPage: boolean;
  fetchNextPage: () => Promise<void>;
  fetchingNextPage: boolean;
  nextPageError: string | null;
}

/** The caller's led or member terms, latest date first, one page at a time. */
export function useMyTerms(role: MyTermRole): UseMyTermsResult {
  const query = useInfiniteQuery({
    queryKey: [MY_TERMS_KEY, role],
    queryFn: ({ pageParam }) => getMyTerms(role, pageParam, MY_TERMS_PAGE_SIZE),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.size < last.total ? last.page + 1 : undefined),
  });
  const { fetchNextPage: fetchNextQueryPage } = query;
  const fetchNextPage = useCallback(async () => {
    await fetchNextQueryPage();
  }, [fetchNextQueryPage]);

  const terms = useMemo(
    () => (query.data ? query.data.pages.flatMap((page) => page.items) : NO_TERMS),
    [query.data],
  );
  return {
    terms,
    total: query.data?.pages[0]?.total ?? 0,
    loading: query.isPending,
    error: query.error && !query.isFetchNextPageError ? extractProblemMessage(query.error) : null,
    hasNextPage: query.hasNextPage,
    fetchNextPage,
    fetchingNextPage: query.isFetchingNextPage,
    nextPageError: query.isFetchNextPageError ? extractProblemMessage(query.error) : null,
  };
}
