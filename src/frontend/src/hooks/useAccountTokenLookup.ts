import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { lookupAccountToken, type AccountTokenLookupResponse, type AccountTokenPurpose } from "../api/auth";
import { extractProblemMessage, hasStatus } from "../api/problem";

export const ACCOUNT_TOKEN_LOOKUP_KEY = "accountTokenLookup";

interface UseAccountTokenLookupResult {
  data: AccountTokenLookupResponse | null;
  loading: boolean;
  /** The token is unknown (404) or expired/used (410). */
  invalid: boolean;
  /** Any other failure (network, 5xx), worth a retry. */
  error: string | null;
  refetch: () => Promise<void>;
}

function isInvalidToken(err: unknown): boolean {
  return hasStatus(err, 404) || hasStatus(err, 410);
}

/** The address a mailed link's token was issued for. Read once and never
 * again on focus or reconnect, so a token used by a successful confirm is
 * not re-read into "invalid". Disabled without a token. */
export function useAccountTokenLookup(token: string | null, purpose: AccountTokenPurpose): UseAccountTokenLookupResult {
  const query = useQuery({
    queryKey: [ACCOUNT_TOKEN_LOOKUP_KEY, purpose, token],
    queryFn: () => lookupAccountToken(token ?? "", purpose),
    enabled: !!token,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const { refetch: queryRefetch } = query;

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  const invalid = query.error !== null && isInvalidToken(query.error);
  return {
    data: query.data ?? null,
    loading: !!token && query.isPending,
    invalid,
    error: query.error && !invalid ? extractProblemMessage(query.error) : null,
    refetch,
  };
}
