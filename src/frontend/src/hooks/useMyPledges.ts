import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { getMyPledges, withdrawPledge, type MyPledgeResponse } from "../api/pledges";
import { extractProblemMessage } from "../api/problem";
import { useAuth } from "../auth/AuthContext";

interface UseMyPledgesResult {
  data: MyPledgeResponse[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  withdraw: (pledgeId: string) => Promise<void>;
}

export const MY_PLEDGES_KEY = "myPledges";
const NO_PLEDGES: MyPledgeResponse[] = [];

/** "Zadeklarowane rzeczy": the caller's own pledges. The token is part of the
 * key, so another account's pledges never show. The panel's `load()` also
 * invalidates this key, so a resolved pending action refreshes the list. */
export function useMyPledges(): UseMyPledgesResult {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [MY_PLEDGES_KEY, token],
    queryFn: getMyPledges,
    enabled: token !== null,
  });
  const { refetch: queryRefetch } = query;

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  const withdraw = useCallback(
    async (pledgeId: string) => {
      try {
        await withdrawPledge(pledgeId);
      } catch (err) {
        throw new Error(extractProblemMessage(err));
      }
      await queryClient.invalidateQueries({ queryKey: [MY_PLEDGES_KEY] });
    },
    [queryClient],
  );

  return {
    data: query.data ?? NO_PLEDGES,
    loading: query.isPending && token !== null,
    error: query.error ? extractProblemMessage(query.error) : null,
    refetch,
    withdraw,
  };
}
