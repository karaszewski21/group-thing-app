import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  getOrganizationOwnerMeetings,
  getPartyOwnerMeetings,
  type OwnerMeetingsResponse,
  type OwnerNearestDate,
} from "../api/ownerItems";
import { extractProblemMessage, hasStatus } from "../api/problem";
import type { OwnerRef } from "./useOwnerItems";

export const OWNER_MEETINGS_KEY = "ownerMeetings";

const NO_MEETINGS: OwnerNearestDate[] = [];

interface UseOwnerMeetingsResult {
  meetings: OwnerNearestDate[];
  owner: OwnerMeetingsResponse["owner"] | null;
  loading: boolean;
  notFound: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** The owner's upcoming public terms and events behind `/:slug/meetings`
 * and `/:partyId/meetings`. Not personalised, so the viewer is not in the key. */
export function useOwnerMeetings(owner: OwnerRef): UseOwnerMeetingsResult {
  const query = useQuery({
    queryKey: [OWNER_MEETINGS_KEY, owner],
    queryFn: () =>
      owner.kind === "organization"
        ? getOrganizationOwnerMeetings(owner.slug)
        : getPartyOwnerMeetings(owner.partyId),
  });
  const { refetch: refetchQuery } = query;
  const refetch = useCallback(async () => {
    await refetchQuery();
  }, [refetchQuery]);

  const notFound = hasStatus(query.error, 404);
  return {
    meetings: query.data?.meetings ?? NO_MEETINGS,
    owner: query.data?.owner ?? null,
    loading: query.isPending,
    notFound,
    error: query.error && !notFound ? extractProblemMessage(query.error) : null,
    refetch,
  };
}
