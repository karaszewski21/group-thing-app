import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { getPartyProfile, type PartyProfileResponse } from "../api/ownerItems";
import { extractProblemMessage, hasStatus } from "../api/problem";
import { useAuth } from "../auth/AuthContext";
import { OWNER_ITEMS_KEY } from "./useOwnerItems";

interface UsePartyProfileResult {
  data: PartyProfileResponse | null;
  loading: boolean;
  notFound: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** The person profile behind `/:partyId`. Under the owner items key, so
 * whatever refreshes an owner's items refreshes the profile too; the viewer
 * is part of the key for `is_me` and the reserved badges. */
export function usePartyProfile(partyId: string): UsePartyProfileResult {
  const { username: viewerUserId } = useAuth();
  const query = useQuery({
    queryKey: [OWNER_ITEMS_KEY, "profile", partyId, viewerUserId ?? null],
    queryFn: () => getPartyProfile(partyId),
  });
  const { refetch: refetchQuery } = query;
  const refetch = useCallback(async () => {
    await refetchQuery();
  }, [refetchQuery]);

  const notFound = hasStatus(query.error, 404);
  return {
    data: query.data ?? null,
    loading: query.isPending,
    notFound,
    error: query.error && !notFound ? extractProblemMessage(query.error) : null,
    refetch,
  };
}
