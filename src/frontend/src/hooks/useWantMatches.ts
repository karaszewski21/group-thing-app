import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { ApiError } from "../api/client";
import { extractProblemMessage } from "../api/problem";
import type { WantMatchResponse, WantResponse, WantSimilarResponse, WantSuggestionResponse } from "../api/wants";
import {
  getWant,
  getWantMatches,
  getWantSimilar,
  getWantSuggestions,
  markWantMatchesSeen,
  markWantMatchOpened,
} from "../api/wants";
import { useAuth } from "../auth/AuthContext";
import { useMatchingPolledQuery, WANTS_KEY } from "./useWants";

interface UseWantMatchesResult {
  want: WantResponse | null;
  matches: WantMatchResponse[];
  /** „Może Cię zainteresuje”: items missing one word of the want's name. */
  suggestions: WantSuggestionResponse[];
  /** „Powiązane rzeczy”: items close in meaning; never counted as matches. */
  similar: WantSimilarResponse[];
  /** Still matching after the 60 s polling window; `refetch` resumes it. */
  slow: boolean;
  loading: boolean;
  /** The want is unknown, foreign, withdrawn or already removed. */
  notFound: boolean;
  error: string | null;
  /** Re-reads the want and opens a new polling window. */
  refetch: () => Promise<void>;
  /** Marks every match as seen; the counters of all wants queries refresh. */
  markSeen: () => Promise<void>;
  markOpened: (itemId: string) => Promise<void>;
}

interface WantWithMatches {
  want: WantResponse;
  matches: WantMatchResponse[];
  suggestions: WantSuggestionResponse[];
  similar: WantSimilarResponse[];
}

const NO_MATCHES: WantMatchResponse[] = [];
const NO_SUGGESTIONS: WantSuggestionResponse[] = [];
const NO_SIMILAR: WantSimilarResponse[] = [];

function wantIsMatching(data: WantWithMatches): boolean {
  return data.want.matching;
}

/** One want with its matches, suggestions and related items, under the wants prefix so
 * that every want write refreshes it. Keyed by token, as the list. While the
 * matcher has yet to answer the want it re-reads every 2 s for 60 s, then
 * reports `slow`. */
export function useWantMatches(wantId: string): UseWantMatchesResult {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const enabled = token !== null && wantId !== "";
  const queryKey = [WANTS_KEY, "matches", token, wantId];
  const { query, slow, restart } = useMatchingPolledQuery({
    queryKey,
    queryFn: async (): Promise<WantWithMatches> => {
      const [want, matches, suggestions, similar] = await Promise.all([
        getWant(wantId),
        getWantMatches(wantId),
        getWantSuggestions(wantId),
        // Non-critical: a failing or missing `/similar` (an older backend
        // answers 404) leaves the want, its matches and suggestions shown,
        // and keeps the related items of the last successful read.
        getWantSimilar(wantId).catch(
          () => queryClient.getQueryData<WantWithMatches>(queryKey)?.similar ?? NO_SIMILAR,
        ),
      ]);
      return { want, matches, suggestions, similar };
    },
    enabled,
    isMatching: wantIsMatching,
  });
  const { refetch: queryRefetch } = query;

  const refetch = useCallback(async () => {
    restart();
    await queryRefetch();
  }, [restart, queryRefetch]);

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
    suggestions: query.data?.suggestions ?? NO_SUGGESTIONS,
    similar: query.data?.similar ?? NO_SIMILAR,
    slow,
    loading: query.isPending && enabled,
    notFound,
    error: query.error && !notFound ? extractProblemMessage(query.error) : null,
    refetch,
    markSeen,
    markOpened,
  };
}
