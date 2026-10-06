import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { getGroupsForModeration, type ModerationGroupResponse } from "../api/groups";
import { extractProblemMessage } from "../api/problem";

const MODERATION_GROUPS_KEY = ["moderationGroups"] as const;
const NO_GROUPS: ModerationGroupResponse[] = [];

interface UseModerationGroupsResult {
  data: ModerationGroupResponse[];
  total: number;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** One page of the ADMIN overview of every Circle with its organizer and
 * counts, newest first; the previous page stays shown while the next loads. */
export function useModerationGroups(page: number): UseModerationGroupsResult {
  const query = useQuery({
    queryKey: [...MODERATION_GROUPS_KEY, page],
    queryFn: () => getGroupsForModeration(page),
    placeholderData: keepPreviousData,
  });
  const { refetch: queryRefetch } = query;

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  return {
    data: query.data?.items ?? NO_GROUPS,
    total: query.data?.total ?? 0,
    loading: query.isPending,
    error: query.error ? extractProblemMessage(query.error) : null,
    refetch,
  };
}
