import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  decideModeration,
  deleteModerationPhoto,
  getModerationPhotos,
  type ModerationDecisionRequest,
  type ModerationQueueEntry,
} from "../api/moderation";
import { extractProblemMessage } from "../api/problem";
import type { ModerationStatus } from "../api/products";

const MODERATION_PHOTOS_KEY = "moderationPhotos";
const NO_ENTRIES: ModerationQueueEntry[] = [];

interface UseModerationPhotosResult {
  data: ModerationQueueEntry[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  decide: (request: ModerationDecisionRequest) => Promise<void>;
  remove: (photoId: string) => Promise<void>;
}

/** Every uploaded photo, newest first; `null` means all statuses. A
 * decision or deletion refreshes every status filter, since the photo
 * moves between (or leaves) them. */
export function useModerationPhotos(status: ModerationStatus | null): UseModerationPhotosResult {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [MODERATION_PHOTOS_KEY, status],
    queryFn: () => getModerationPhotos(status),
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
      await queryClient.invalidateQueries({ queryKey: [MODERATION_PHOTOS_KEY] });
    },
    [queryClient],
  );

  const remove = useCallback(
    async (photoId: string) => {
      try {
        await deleteModerationPhoto(photoId);
      } catch (err) {
        throw new Error(extractProblemMessage(err));
      }
      await queryClient.invalidateQueries({ queryKey: [MODERATION_PHOTOS_KEY] });
    },
    [queryClient],
  );

  return {
    data: query.data ?? NO_ENTRIES,
    loading: query.isPending,
    error: query.error ? extractProblemMessage(query.error) : null,
    refetch,
    decide,
    remove,
  };
}
