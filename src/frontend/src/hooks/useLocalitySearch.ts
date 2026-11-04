import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import type { LocalitySearchResult } from "../api/localities";
import { searchLocalities } from "../api/localities";
import { extractProblemMessage } from "../api/problem";

interface UseLocalitySearchResult {
  data: LocalitySearchResult[];
  /** The full match count, for the "… i N więcej" line. */
  total: number;
  /** Also true while the typed text waits out the debounce. */
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export const LOCALITIES_KEY = ["localities"] as const;
const NO_RESULTS: LocalitySearchResult[] = [];
const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

/** Localities matching the typed name or postal code. The trimmed text is
 * debounced by 300 ms; below 2 characters nothing is requested and the result
 * is empty at once. The previous results stay shown while the next load. */
export function useLocalitySearch(q: string, limit = 10): UseLocalitySearchResult {
  const term = q.trim();
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  const searchable = term.length >= MIN_QUERY_LENGTH;
  const query = useQuery({
    queryKey: [...LOCALITIES_KEY, { q: debounced, limit }],
    queryFn: () => searchLocalities(debounced, limit),
    enabled: searchable && debounced.length >= MIN_QUERY_LENGTH,
    placeholderData: keepPreviousData,
  });
  const { refetch: queryRefetch } = query;

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  return {
    data: searchable ? (query.data?.results ?? NO_RESULTS) : NO_RESULTS,
    total: searchable ? (query.data?.total ?? 0) : 0,
    loading: searchable && query.isPending,
    error: searchable && query.error ? extractProblemMessage(query.error) : null,
    refetch,
  };
}
