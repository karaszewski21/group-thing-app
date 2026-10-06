import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { extractProblemMessage } from "../api/problem";
import { getTermsForModeration, type ModerationTermResponse } from "../api/terms";

const MODERATION_TERMS_KEY = ["moderationTerms"] as const;
const NO_TERMS: ModerationTermResponse[] = [];

interface UseModerationTermsResult {
  data: ModerationTermResponse[];
  total: number;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** One page of the ADMIN overview of Terms across every Circle, latest
 * first; the previous page stays shown while the next loads. */
export function useModerationTerms(page: number): UseModerationTermsResult {
  const query = useQuery({
    queryKey: [...MODERATION_TERMS_KEY, page],
    queryFn: () => getTermsForModeration(page),
    placeholderData: keepPreviousData,
  });
  const { refetch: queryRefetch } = query;

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  return {
    data: query.data?.items ?? NO_TERMS,
    total: query.data?.total ?? 0,
    loading: query.isPending,
    error: query.error ? extractProblemMessage(query.error) : null,
    refetch,
  };
}
