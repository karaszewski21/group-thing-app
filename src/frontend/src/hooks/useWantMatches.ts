import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { ApiError } from "../api/client";
import { extractProblemMessage } from "../api/problem";
import type { WantMatchResponse, WantResponse } from "../api/wants";
import { getWant, getWantMatches, markWantMatchesSeen, markWantMatchOpened } from "../api/wants";
import { useAuth } from "../auth/AuthContext";
import { WANTS_KEY } from "./useWants";

interface UseWantMatchesResult {
  want: WantResponse | null;
  matches: WantMatchResponse[];
  loading: boolean;
  /** The want is unknown, foreign, withdrawn or already removed. */
  notFound: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  /** Marks every match as seen; the counters of all wants queries refresh. */
  markSeen: () => Promise<void>;
  markOpened: (itemId: string) => Promise<void>;
}

const NO_MATCHES: WantMatchResponse[] = [];

/** One want with its matches, under the wants prefix so that every want
 * write refreshes it. Keyed by token, as the list. */
export function useWantMatches(wantId: string): UseWantMatchesResult {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const enabled = token !== null && wantId !== "";
  const query = useQuery({
    queryKey: [WANTS_KEY, "matches", token, wantId],
    queryFn: async () => {
      const [want, matches] = await Promise.all([getWant(wantId), getWantMatches(wantId)]);
      return { want, matches };
    },
    enabled,
  });
  const { refetch: queryRefetch } = query;

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  const markSeen = useCallback(async () => {
    try {
      await markWantMatchesSeen(wantId);
    } catch (err) {
      throw new Error(extractProblemMessage(err));
    }
    await queryClient.invalidateQueries({ queryKey: [WANTS_KEY] });
  }, [wantId, queryClient]);

  const markOpened = useCallback(
    async (itemId: string) => {
      try {
        await markWantMatchOpened(wantId, itemId);
      } catch (err) {
        throw new Error(extractProblemMessage(err));
      }
    },
    [wantId],
  );

  const notFound = query.error instanceof ApiError && query.error.status === 404;
  return {
    want: query.data?.want ?? null,
    matches: query.data?.matches ?? NO_MATCHES,
    loading: query.isPending && enabled,
    notFound,
    error: query.error && !notFound ? extractProblemMessage(query.error) : null,
    refetch,
    markSeen,
    markOpened,
  };
}
