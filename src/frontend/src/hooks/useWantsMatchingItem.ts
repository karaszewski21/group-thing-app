import { useQuery } from "@tanstack/react-query";
import { getMyWants, type WantResponse } from "../api/wants";
import { useAuth } from "../auth/AuthContext";
import { WANTS_KEY } from "./useWants";

const NO_WANTS: WantResponse[] = [];

/** The caller's active wants holding `itemId` as a match; idle while
 * `itemId` is `null` or nobody is logged in. Under the wants prefix, so
 * every wants write refreshes it. A failed lookup reads as no wants. */
export function useWantsMatchingItem(itemId: string | null): { data: WantResponse[] } {
  const { token } = useAuth();
  const query = useQuery({
    queryKey: [WANTS_KEY, "matching", token, itemId],
    queryFn: () => getMyWants(itemId ?? undefined),
    enabled: token !== null && itemId !== null,
  });
  return { data: query.data ?? NO_WANTS };
}
