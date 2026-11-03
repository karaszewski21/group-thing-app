import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { getOrganizerPage, type OrganizerPageResponse } from "../api/groups";
import { extractProblemMessage, hasStatus } from "../api/problem";
import { useAuth } from "../auth/AuthContext";

export const ORGANIZER_PAGE_KEY = "organizerPage";

interface UseOrganizerPageResult {
  data: OrganizerPageResponse | null;
  loading: boolean;
  notFound: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** The organizer's public directory (circles, terms, exchange, stats) behind
 * `/:slug`. A 404 is reported as `notFound`. The reserved badges
 * are personalised, so the viewer's user id is part of the key. */
export function useOrganizerPage(slug: string): UseOrganizerPageResult {
  const { username: viewerUserId } = useAuth();
  const query = useQuery({
    queryKey: [ORGANIZER_PAGE_KEY, slug, viewerUserId ?? null],
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
