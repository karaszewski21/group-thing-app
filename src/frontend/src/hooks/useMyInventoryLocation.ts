import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { getMyInventoryLocation, setMyInventoryLocation } from "../api/inventories";
import type { LocationRefResponse } from "../api/locations";
import { extractProblemMessage } from "../api/problem";
import { useAuth } from "../auth/AuthContext";
import { ITEM_ACTIONS_KEY } from "./useItemActions";

export const MY_INVENTORY_LOCATION_KEY = "my-inventory-location";

export interface UseMyInventoryLocationResult {
  /** The pickup place, or `null` when unset. */
  data: LocationRefResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  /** Sets (or with `null` clears) the place; rejects with the server's message. */
  set: (locationId: string | null) => Promise<void>;
}

/** The caller's pickup place on their PERSONAL inventory. The user id keys
 * the query so another account's place never shows. Saving also refreshes
 * the item pages, whose location block and personal pickup depend on it. */
export function useMyInventoryLocation(): UseMyInventoryLocationResult {
  const { username: viewerUserId } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [MY_INVENTORY_LOCATION_KEY, viewerUserId],
    queryFn: getMyInventoryLocation,
    enabled: viewerUserId !== null,
  });
  const { refetch: refetchQuery } = query;

  const refetch = useCallback(async () => {
    await refetchQuery();
  }, [refetchQuery]);

  const set = useCallback(
    async (locationId: string | null) => {
      try {
        await setMyInventoryLocation({ location_id: locationId });
      } catch (err) {
        throw new Error(extractProblemMessage(err));
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [MY_INVENTORY_LOCATION_KEY] }),
        queryClient.invalidateQueries({ queryKey: [ITEM_ACTIONS_KEY] }),
      ]);
    },
    [queryClient],
  );

  return {
    data: query.data?.location ?? null,
    loading: query.isPending && viewerUserId !== null,
    error: query.error ? extractProblemMessage(query.error) : null,
    refetch,
    set,
  };
}
