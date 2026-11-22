import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  closeAttendance,
  getTermAttendance,
  setPresence as putPresence,
  type TermAttendanceResponse,
} from "../api/groups";
import { extractProblemMessage, hasStatus } from "../api/problem";
import { TERM_ATTENDEES_KEY } from "./useTermAttendees";

/** Query-key prefix of a term's attendance read. */
export const TERM_ATTENDANCE_KEY = "termAttendance";

interface UseTermAttendanceResult {
  attendance: TermAttendanceResponse | null;
  denied: boolean;
  notFound: boolean;
  /** Any other read error. */
  error: string | null;
  refetch: () => Promise<void>;
  /** Rejects with the server's message (e.g. the 409 of a closed list). */
  setPresence: (partyId: string, present: boolean) => Promise<void>;
  /** Rejects with the server's message. */
  close: () => Promise<void>;
}

/** The organizer's attendance read of one term plus its presence and close
 * writes. Each write, failed or not, awaits invalidation of the attendance
 * and attendee reads, so a list closed meanwhile shows up at once. The read
 * waits for `groupId`, which the caller learns from the term. */
export function useTermAttendance(groupId: string | undefined, termId: string): UseTermAttendanceResult {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [TERM_ATTENDANCE_KEY, groupId, termId],
    queryFn: () => getTermAttendance(groupId as string, termId),
    enabled: groupId !== undefined && termId !== "",
  });
  const { refetch: queryRefetch } = query;

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  const invalidate = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [TERM_ATTENDANCE_KEY] }),
      queryClient.invalidateQueries({ queryKey: [TERM_ATTENDEES_KEY] }),
    ]);
  }, [queryClient]);

  const setPresence = useCallback(
    async (partyId: string, present: boolean) => {
      if (groupId === undefined) return;
      try {
        await putPresence(groupId, termId, partyId, present);
      } catch (err) {
        throw new Error(extractProblemMessage(err));
      } finally {
        await invalidate();
      }
    },
    [groupId, termId, invalidate],
  );

  const close = useCallback(async () => {
    if (groupId === undefined) return;
    try {
      await closeAttendance(groupId, termId);
    } catch (err) {
      throw new Error(extractProblemMessage(err));
    } finally {
      await invalidate();
    }
  }, [groupId, termId, invalidate]);

  const { error } = query;
  const denied = hasStatus(error, 403);
  const notFound = hasStatus(error, 404);
  return {
    attendance: query.data ?? null,
    denied,
    notFound,
    error: error && !denied && !notFound ? extractProblemMessage(error) : null,
    refetch,
    setPresence,
    close,
  };
}
