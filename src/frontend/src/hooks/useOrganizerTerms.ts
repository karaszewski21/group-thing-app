import { useInfiniteQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { getOrganizerTerms, type OrganizerTerm } from "../api/groups";
import { extractProblemMessage, hasStatus } from "../api/problem";

export const ORGANIZER_TERMS_KEY = "organizerTerms";

const NO_TERMS: OrganizerTerm[] = [];

export interface UseOrganizerTermsResult {
  terms: OrganizerTerm[];
  total: number;
  loading: boolean;
  notFound: boolean;
  /** A first-page failure; a later page's failure goes to `nextPageError`. */
  error: string | null;
  hasNextPage: boolean;
  fetchNextPage: () => Promise<void>;
  fetchingNextPage: boolean;
  nextPageError: string | null;
  refetch: () => Promise<void>;
}

/** The organizer's upcoming terms, 20 per page, optionally narrowed to one
 * circle. `enabled: false` holds the request back (e.g. until a `group_id`
 * from the URL is validated against the directory). */
export function useOrganizerTerms(
  slug: string,
  groupId?: string,
  { enabled = true }: { enabled?: boolean } = {},
): UseOrganizerTermsResult {
  const query = useInfiniteQuery({
    queryKey: [ORGANIZER_TERMS_KEY, slug, groupId ?? null],
    queryFn: ({ pageParam }) => getOrganizerTerms(slug, pageParam, groupId),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.size < last.total ? last.page + 1 : undefined),
    enabled,
  });
  const { fetchNextPage: fetchNextQueryPage, refetch: refetchQuery } = query;
  const fetchNextPage = useCallback(async () => {
    await fetchNextQueryPage();
  }, [fetchNextQueryPage]);
  const refetch = useCallback(async () => {
    await refetchQuery();
  }, [refetchQuery]);

  const terms = useMemo(
    () => (query.data ? query.data.pages.flatMap((page) => page.items) : NO_TERMS),
    [query.data],
  );
  const firstPageError = query.error && !query.isFetchNextPageError ? query.error : null;
  const notFound = hasStatus(firstPageError, 404);
  return {
    terms,
    total: query.data?.pages[0]?.total ?? 0,
    loading: query.isPending,
    notFound,
    error: firstPageError && !notFound ? extractProblemMessage(firstPageError) : null,
    hasNextPage: query.hasNextPage,
    fetchNextPage,
    fetchingNextPage: query.isFetchingNextPage,
    nextPageError: query.isFetchNextPageError ? extractProblemMessage(query.error) : null,
    refetch,
  };
}
