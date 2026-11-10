import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { extractProblemMessage } from "../api/problem";
import { getTerm, type TermResponse } from "../api/terms";

export const TERM_KEY = "term";

interface UseTermResult {
  term: TermResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** One term by id. */
export function useTerm(termId: string, { enabled }: { enabled: boolean }): UseTermResult {
  const query = useQuery({
    queryKey: [TERM_KEY, termId],
    queryFn: () => getTerm(termId),
    enabled,
  });
  const { refetch: queryRefetch } = query;
  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);
  return {
    term: query.data ?? null,
    loading: enabled && query.isPending,
    error: query.error ? extractProblemMessage(query.error) : null,
    refetch,
  };
}
