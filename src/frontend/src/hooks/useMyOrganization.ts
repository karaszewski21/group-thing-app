import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { getMyOrganization, type OrganizationResponse } from "../api/organizations";
import { extractProblemMessage, hasStatus } from "../api/problem";
import { useAuth } from "../auth/AuthContext";

export const MY_ORGANIZATION_KEY = "myOrganization";

interface UseMyOrganizationResult {
  data: OrganizationResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** The logged-in caller's own Organization, or `null` when they have none
 * yet (the endpoint 404s, which is not an error) or nobody is logged in.
 * The token is part of the key: another account's organization must never
 * show, even briefly. */
export function useMyOrganization(): UseMyOrganizationResult {
  const { token } = useAuth();
  const query = useQuery({
    queryKey: [MY_ORGANIZATION_KEY, token],
    queryFn: getMyOrganization,
    enabled: token !== null,
  });
  const { refetch: refetchQuery } = query;
  const refetch = useCallback(async () => {
    await refetchQuery();
  }, [refetchQuery]);

  return {
    data: query.data ?? null,
    loading: token !== null && query.isPending,
    error: query.error && !hasStatus(query.error, 404) ? extractProblemMessage(query.error) : null,
    refetch,
  };
}
