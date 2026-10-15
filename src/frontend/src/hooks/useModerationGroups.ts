import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  getGroupsForModeration,
  restoreGroup,
  type ModerationGroupResponse,
} from "../api/groups";
import { extractProblemMessage } from "../api/problem";

const MODERATION_GROUPS_KEY = "moderationGroups";
const NO_GROUPS: ModerationGroupResponse[] = [];

interface UseModerationGroupsResult {
  data: ModerationGroupResponse[];
  total: number;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  restore: (groupId: string) => Promise<void>;
}

/** One page of the ADMIN overview of every Circle with its organizer and
 * counts, newest first; `deleted` lists the soft-deleted Circles instead of
 * the active ones. The previous page stays shown while the next page of the
 * same listing loads (never across the Active/Deleted switch). A
 * restore refreshes both listings and every page, since the Circle moves
 * between them. */
export function useModerationGroups(page: number, deleted: boolean): UseModerationGroupsResult {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [MODERATION_GROUPS_KEY, deleted, page],
    queryFn: () => getGroupsForModeration(page, deleted),
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === deleted ? prev : undefined),
  });
  const { refetch: queryRefetch } = query;

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  const restore = useCallback(
    async (groupId: string) => {
      try {
        await restoreGroup(groupId);
      } catch (err) {
        throw new Error(extractProblemMessage(err));
      }
      await queryClient.invalidateQueries({ queryKey: [MODERATION_GROUPS_KEY] });
    },
    [queryClient],
  );

  return {
    data: query.data?.items ?? NO_GROUPS,
    total: query.data?.total ?? 0,
    loading: query.isPending,
    error: query.error ? extractProblemMessage(query.error) : null,
    refetch,
    restore,
  };
}
