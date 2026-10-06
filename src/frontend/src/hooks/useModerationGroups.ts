import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { getGroupsForModeration, type ModerationGroupResponse } from "../api/groups";
import { extractProblemMessage } from "../api/problem";

const MODERATION_GROUPS_KEY = ["moderationGroups"] as const;
const NO_GROUPS: ModerationGroupResponse[] = [];

interface UseModerationGroupsResult {
  data: ModerationGroupResponse[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** ADMIN overview of every Circle with its organizer and counts. */
export function useModerationGroups(): UseModerationGroupsResult {
  const query = useQuery({ queryKey: MODERATION_GROUPS_KEY, queryFn: getGroupsForModeration });
  const { refetch: queryRefetch } = query;

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  return {
    data: query.data ?? NO_GROUPS,
    loading: query.isPending,
    error: query.error ? extractProblemMessage(query.error) : null,
    refetch,
  };
}
