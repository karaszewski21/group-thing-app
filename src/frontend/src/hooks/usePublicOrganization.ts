import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { getPublicOrganization, type PublicOrganizationResponse } from "../api/organizations";
import { extractProblemMessage } from "../api/problem";
import { hasStatus } from "./useTermAttendees";

export const PUBLIC_ORGANIZATION_KEY = "publicOrganization";

interface UsePublicOrganizationResult {
  data: PublicOrganizationResponse | null;
  loading: boolean;
  notFound: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** The public organizer profile behind `/:organizationSlug`. A 404 is
 * reported as `notFound` rather than as an error message. */
export function usePublicOrganization(slug: string): UsePublicOrganizationResult {
  const query = useQuery({
    queryKey: [PUBLIC_ORGANIZATION_KEY, slug],
    queryFn: () => getPublicOrganization(slug),
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
