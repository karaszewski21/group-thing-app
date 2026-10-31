import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { ExchangeMode } from "../api/groups";
import {
  getOrganizationOwnerItems,
  getPartyOwnerItems,
  type OwnerItemCard,
  type OwnerItemsPageResponse,
} from "../api/ownerItems";
import { extractProblemMessage, hasStatus } from "../api/problem";

export const OWNER_ITEMS_KEY = "ownerItems";

/** Whose items: an Organization by slug, or any person by party id. */
export type OwnerRef = { kind: "organization"; slug: string } | { kind: "party"; partyId: string };

const NO_ITEMS: OwnerItemCard[] = [];

export interface UseOwnerItemsResult {
  items: OwnerItemCard[];
  owner: OwnerItemsPageResponse["owner"] | null;
  nearest: OwnerItemsPageResponse["nearest"];
  counts: OwnerItemsPageResponse["counts"] | null;
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

function fetchPage(owner: OwnerRef, page: number, mode?: ExchangeMode): Promise<OwnerItemsPageResponse> {
  return owner.kind === "organization"
    ? getOrganizationOwnerItems(owner.slug, page, mode)
    : getPartyOwnerItems(owner.partyId, page, mode);
}

/** One owner's listed items, 20 per page, optionally narrowed to one mode.
 * While a new mode loads, the previous mode's data stays, so the owner
 * header and the (unfiltered) counts never blank out. */
export function useOwnerItems(owner: OwnerRef, mode?: ExchangeMode): UseOwnerItemsResult {
  const query = useInfiniteQuery({
    queryKey: [OWNER_ITEMS_KEY, owner, mode ?? null],
    queryFn: ({ pageParam }) => fetchPage(owner, pageParam, mode),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.size < last.total ? last.page + 1 : undefined),
    placeholderData: keepPreviousData,
  });
  const { fetchNextPage: fetchNextQueryPage, refetch: refetchQuery } = query;
  const fetchNextPage = useCallback(async () => {
    await fetchNextQueryPage();
  }, [fetchNextQueryPage]);
  const refetch = useCallback(async () => {
    await refetchQuery();
  }, [refetchQuery]);

  const items = useMemo(
    () => (query.data ? query.data.pages.flatMap((page) => page.items) : NO_ITEMS),
    [query.data],
  );
  const first = query.data?.pages[0];
  const firstPageError = query.error && !query.isFetchNextPageError ? query.error : null;
  const notFound = hasStatus(firstPageError, 404);
  return {
    items,
    owner: first?.owner ?? null,
    nearest: first?.nearest ?? null,
    counts: first?.counts ?? null,
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
