import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { getJoinCode, regenerateJoinCode, type JoinCodeResponse } from "../api/groups";
import { hasStatus, serverMessageOr } from "../api/problem";

export const JOIN_CODE_KEY = "joinCode";

export type JoinCodeStatus = "idle" | "loading" | "ready" | "denied" | "error";

interface UseJoinCodeResult {
  code: string | null;
  /** `idle` = the query is disabled; `denied` = 403 (the caller is not the
   * organizer); `error` = any other failure. */
  status: JoinCodeStatus;
  refetch: () => Promise<void>;
  regenerate: () => Promise<void>;
}

/** The organizer's access code for a PRIVATE group. Call it once per
 * screen, from the host page, and pass the result down as props. */
export function useJoinCode(groupId: string, { enabled }: { enabled: boolean }): UseJoinCodeResult {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [JOIN_CODE_KEY, groupId],
    queryFn: () => getJoinCode(groupId),
    enabled,
  });
  const { refetch: queryRefetch } = query;

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  // The POST returns the new code, so it goes straight into the cache
  // instead of a follow-up GET.
  const regenerate = useCallback(async () => {
    let res: JoinCodeResponse;
    try {
      res = await regenerateJoinCode(groupId);
    } catch (err) {
      throw new Error(serverMessageOr(err, "Nie udało się wygenerować kodu — spróbuj ponownie"));
    }
    queryClient.setQueryData([JOIN_CODE_KEY, groupId], res);
  }, [groupId, queryClient]);

  let status: JoinCodeStatus;
  if (query.data) status = "ready";
  else if (!enabled) status = "idle";
  else if (hasStatus(query.error, 403)) status = "denied";
  else if (query.error) status = "error";
  else status = "loading";

  return { code: query.data?.code ?? null, status, refetch, regenerate };
}
