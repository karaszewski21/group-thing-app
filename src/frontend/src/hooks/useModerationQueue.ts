import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  decideModeration,
  getModerationQueue,
  type ModerationDecisionRequest,
  type ModerationQueueEntry,
} from "../api/moderation";
import { extractProblemMessage } from "../api/problem";
import type { ModerationStatus } from "../api/products";

const MODERATION_QUEUE_KEY = "moderationQueue";
const NO_ENTRIES: ModerationQueueEntry[] = [];

interface UseModerationQueueResult {
  data: ModerationQueueEntry[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  decide: (request: ModerationDecisionRequest) => Promise<void>;
}

/** The admin review queue for one status. A decision refreshes every
 * status's queue, since the subject moves between them. */
export function useModerationQueue(status: ModerationStatus): UseModerationQueueResult {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [MODERATION_QUEUE_KEY, status],
    queryFn: () => getModerationQueue(status),
  });
  const { refetch: queryRefetch } = query;

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  const decide = useCallback(
    async (request: ModerationDecisionRequest) => {
      try {
        await decideModeration(request);
      } catch (err) {
        throw new Error(extractProblemMessage(err));
      }
      await queryClient.invalidateQueries({ queryKey: [MODERATION_QUEUE_KEY] });
    },
    [queryClient],
  );

  return {
    data: query.data ?? NO_ENTRIES,
    loading: query.isPending,
    error: query.error ? extractProblemMessage(query.error) : null,
    refetch,
    decide,
  };
}
