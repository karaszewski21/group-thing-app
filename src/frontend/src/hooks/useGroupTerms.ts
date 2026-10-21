import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { extractProblemMessage } from "../api/problem";
import { getTerms, type TermResponse } from "../api/terms";

const GROUP_TERMS_KEY = "groupTerms";
const NO_TERMS: TermResponse[] = [];

interface UseGroupTermsResult {
  data: TermResponse[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** Every Term of one Circle. */
export function useGroupTerms(groupId: string, { enabled }: { enabled: boolean }): UseGroupTermsResult {
  const query = useQuery({
    queryKey: [GROUP_TERMS_KEY, groupId],
    queryFn: () => getTerms(groupId),
    enabled,
  });
  const { refetch: queryRefetch } = query;

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  return {
    data: query.data ?? NO_TERMS,
    loading: query.isPending,
    error: query.error ? extractProblemMessage(query.error) : null,
    refetch,
  };
}
