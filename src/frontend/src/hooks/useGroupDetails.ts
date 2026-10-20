import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  getGroup,
  getGroupMembers,
  type GroupMemberResponse,
  type GroupResponse,
} from "../api/groups";
import { extractProblemMessage, hasStatus } from "../api/problem";

const GROUP_KEY = "group";
const GROUP_MEMBERS_KEY = "groupMembers";

const NO_MEMBERS: GroupMemberResponse[] = [];

interface UseGroupDetailsResult {
  group: GroupResponse | null;
  members: GroupMemberResponse[];
  denied: boolean;
  notFound: boolean;
  error: string | null;
  loading: boolean;
  refetch: () => Promise<void>;
}

/** The group details page's data: the group and its standing member list,
 * fetched in parallel (both keyed by `groupId`). A 403/404 on either query
 * is reported as `denied`/`notFound`; any other failure lands in `error`. */
export function useGroupDetails(groupId: string): UseGroupDetailsResult {
  const groupQ = useQuery({
    queryKey: [GROUP_KEY, groupId],
    queryFn: () => getGroup(groupId),
  });
  const membersQ = useQuery({
    queryKey: [GROUP_MEMBERS_KEY, groupId],
    queryFn: () => getGroupMembers(groupId),
  });

  const { refetch: refetchGroup } = groupQ;
  const { refetch: refetchMembers } = membersQ;
  const refetch = useCallback(async () => {
    await Promise.all([refetchGroup(), refetchMembers()]);
  }, [refetchGroup, refetchMembers]);

  const denied = hasStatus(groupQ.error, 403) || hasStatus(membersQ.error, 403);
  const notFound = hasStatus(groupQ.error, 404) || hasStatus(membersQ.error, 404);
  const otherError = [groupQ.error, membersQ.error].find(
    (err) => err && !hasStatus(err, 403) && !hasStatus(err, 404),
  );

  return {
    group: groupQ.data ?? null,
    members: membersQ.data ?? NO_MEMBERS,
    denied,
    notFound,
    error: otherError ? extractProblemMessage(otherError) : null,
    loading: groupQ.isPending || membersQ.isPending,
    refetch,
  };
}
