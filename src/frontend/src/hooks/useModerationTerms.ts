import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { extractProblemMessage } from "../api/problem";
import { getTermsForModeration, type ModerationTermResponse } from "../api/terms";

const MODERATION_TERMS_KEY = ["moderationTerms"] as const;
const NO_TERMS: ModerationTermResponse[] = [];

interface UseModerationTermsResult {
  data: ModerationTermResponse[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** ADMIN overview of the latest Terms across every Circle. */
export function useModerationTerms(): UseModerationTermsResult {
  const query = useQuery({ queryKey: MODERATION_TERMS_KEY, queryFn: getTermsForModeration });
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
