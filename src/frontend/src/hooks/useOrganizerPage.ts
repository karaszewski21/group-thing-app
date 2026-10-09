import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { getOrganizerPage, type OrganizerPageResponse } from "../api/groups";
import { extractProblemMessage } from "../api/problem";
import { hasStatus } from "./useTermAttendees";

export const ORGANIZER_PAGE_KEY = "organizerPage";

interface UseOrganizerPageResult {
  data: OrganizerPageResponse | null;
  loading: boolean;
  notFound: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** The organizer's public directory (circles, terms, exchange, stats) behind
 * `/:organizationSlug`. A 404 is reported as `notFound`. */
export function useOrganizerPage(slug: string): UseOrganizerPageResult {
  const query = useQuery({
    queryKey: [ORGANIZER_PAGE_KEY, slug],
    queryFn: () => getOrganizerPage(slug),
  });
  const { refetch: refetchQuery } = query;
  const refetch = useCallback(async () => {
    await refetchQuery();
  }, [refetchQuery]);

  const notFound = hasStatus(query.error, 404);
  return {
    data: query.data ?? null,
    loading: query.isPending,
    notFound,
    error: query.error && !notFound ? extractProblemMessage(query.error) : null,
    refetch,
  };
}
