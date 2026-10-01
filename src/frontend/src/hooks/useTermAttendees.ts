import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { ApiError } from "../api/client";
import {
  getGroup,
  getTermAttendeesForFormalization,
  type GroupResponse,
  type TermAttendeeResponse,
} from "../api/groups";
import { extractProblemMessage } from "../api/problem";
import { getTerm, type TermResponse } from "../api/terms";

const TERM_KEY = "term";
const GROUP_KEY = "group";
const TERM_ATTENDEES_KEY = "termAttendees";

const NO_ATTENDEES: TermAttendeeResponse[] = [];

interface UseTermAttendeesResult {
  term: TermResponse | null;
  group: GroupResponse | null;
  attendees: TermAttendeeResponse[];
  denied: boolean;
  notFound: boolean;
  error: string | null;
  loading: boolean;
  refetch: () => Promise<void>;
}

function hasStatus(err: unknown, status: number): boolean {
  return err instanceof ApiError && err.status === status;
}

/** The organizer attendees page's data: the term, then (once the term is
 * known, since the route carries only `termId`) its group and the attendee
 * list, both keyed by `term.circle_group_id`. A disabled dependent query
 * stays `isPending` forever in TanStack v5, so `loading` counts the
 * dependents only after the term query has succeeded. */
export function useTermAttendees(termId: string): UseTermAttendeesResult {
  const termQ = useQuery({
    queryKey: [TERM_KEY, termId],
    queryFn: () => getTerm(termId),
  });
  const groupId = termQ.data?.circle_group_id;
  const dependentsEnabled = termQ.isSuccess && groupId !== undefined;

  const groupQ = useQuery({
    queryKey: [GROUP_KEY, groupId],
    queryFn: () => getGroup(groupId as string),
    enabled: dependentsEnabled,
  });
  const attendeesQ = useQuery({
    queryKey: [TERM_ATTENDEES_KEY, groupId, termId],
    queryFn: () => getTermAttendeesForFormalization(groupId as string, termId),
    enabled: dependentsEnabled,
  });

  const { refetch: refetchTerm } = termQ;
  const { refetch: refetchGroup } = groupQ;
  const { refetch: refetchAttendees } = attendeesQ;
  // Dependents may only be refetched directly when they already hold the
  // real group id; after a failed term they still carry `groupId: undefined`
  // and must instead be started by `enabled` on the next render.
  const refetch = useCallback(async () => {
    const result = await refetchTerm();
    if (!result.isSuccess || !dependentsEnabled) return;
    await Promise.all([refetchGroup(), refetchAttendees()]);
  }, [refetchTerm, refetchGroup, refetchAttendees, dependentsEnabled]);

  const denied = hasStatus(termQ.error, 403) || hasStatus(attendeesQ.error, 403);
  const notFound = hasStatus(termQ.error, 404) || hasStatus(attendeesQ.error, 404);
  const otherError =
    (termQ.error && !hasStatus(termQ.error, 403) && !hasStatus(termQ.error, 404)
      ? termQ.error
      : null) ??
    groupQ.error ??
    (attendeesQ.error && !hasStatus(attendeesQ.error, 403) && !hasStatus(attendeesQ.error, 404)
      ? attendeesQ.error
      : null);

  return {
    term: termQ.data ?? null,
    group: groupQ.data ?? null,
    attendees: attendeesQ.data ?? NO_ATTENDEES,
    denied,
    notFound,
    error: otherError ? extractProblemMessage(otherError) : null,
    loading: termQ.isPending || (termQ.isSuccess && (groupQ.isPending || attendeesQ.isPending)),
    refetch,
  };
}
