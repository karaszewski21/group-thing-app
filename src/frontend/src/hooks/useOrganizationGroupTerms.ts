import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { getOrganizationGroupTerms, type OrganizationGroupTermsResponse } from "../api/organizations";
import { extractProblemMessage, hasStatus } from "../api/problem";

export const ORGANIZATION_GROUP_TERMS_KEY = "organizationGroupTerms";

interface UseOrganizationGroupTermsResult {
  data: OrganizationGroupTermsResponse | null;
  loading: boolean;
  notFound: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** One group of the Organization with its upcoming terms, behind
 * `/:slug/group/:groupId/terms`. Not personalised, so the viewer is not in
 * the key. */
export function useOrganizationGroupTerms(slug: string, groupId: string): UseOrganizationGroupTermsResult {
  const query = useQuery({
    queryKey: [ORGANIZATION_GROUP_TERMS_KEY, slug, groupId],
    queryFn: () => getOrganizationGroupTerms(slug, groupId),
  });
  const { refetch: refetchQuery } = query;
  const refetch = useCallback(async () => {
    await refetchQuery();
  }, [refetchQuery]);

  // A malformed group id is a 400, and just as missing.
  const notFound = hasStatus(query.error, 404) || hasStatus(query.error, 400);
  return {
    data: query.data ?? null,
    loading: query.isPending,
    notFound,
    error: query.error && !notFound ? extractProblemMessage(query.error) : null,
    refetch,
  };
}
