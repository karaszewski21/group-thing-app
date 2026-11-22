import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { getMyPoints, getMyPointsHistory, type PointHistoryEntry, type PointsSummary } from "../api/points";
import { extractProblemMessage } from "../api/problem";
import { POINTS_KEY } from "./usePointsConfig";

const NO_ENTRIES: PointHistoryEntry[] = [];

interface UseMyPointsResult {
  data: PointsSummary | null;
  loading: boolean;
  error: string | null;
}

/** The caller's balance and reputation. */
export function useMyPoints(): UseMyPointsResult {
  const query = useQuery({ queryKey: [POINTS_KEY, "me"], queryFn: getMyPoints });
  return {
    data: query.data ?? null,
    loading: query.isPending,
    error: query.error ? extractProblemMessage(query.error) : null,
  };
}

export interface UseMyPointsHistoryResult {
  entries: PointHistoryEntry[];
  loading: boolean;
  /** A first-page failure; a later page's failure goes to `nextPageError`. */
  error: string | null;
  hasNextPage: boolean;
  fetchNextPage: () => Promise<void>;
  fetchingNextPage: boolean;
  nextPageError: string | null;
}

/** The caller's point history, newest first, one page at a time. */
export function useMyPointsHistory(): UseMyPointsHistoryResult {
  const query = useInfiniteQuery({
    queryKey: [POINTS_KEY, "me", "history"],
    queryFn: ({ pageParam }) => getMyPointsHistory(pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.size < last.total ? last.page + 1 : undefined),
  });
  const { fetchNextPage: fetchNextQueryPage } = query;
  const fetchNextPage = useCallback(async () => {
    await fetchNextQueryPage();
  }, [fetchNextQueryPage]);

  const entries = useMemo(
    () => (query.data ? query.data.pages.flatMap((page) => page.items) : NO_ENTRIES),
    [query.data],
  );
  return {
    entries,
    loading: query.isPending,
    error: query.error && !query.isFetchNextPageError ? extractProblemMessage(query.error) : null,
    hasNextPage: query.hasNextPage,
    fetchNextPage,
    fetchingNextPage: query.isFetchingNextPage,
    nextPageError: query.isFetchNextPageError ? extractProblemMessage(query.error) : null,
  };
}
