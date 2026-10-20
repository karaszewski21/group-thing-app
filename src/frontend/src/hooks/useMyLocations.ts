import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { CreateLocationRequest, LocationResponse, UpdateLocationRequest } from "../api/locations";
import {
  createLocation as apiCreateLocation,
  deleteLocation as apiDeleteLocation,
  getMyLocations,
  updateLocation as apiUpdateLocation,
} from "../api/locations";
import { extractProblemMessage } from "../api/problem";
import { useAuth } from "../auth/AuthContext";

interface UseMyLocationsResult {
  data: LocationResponse[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  create: (request: CreateLocationRequest) => Promise<LocationResponse>;
  update: (id: string, request: UpdateLocationRequest) => Promise<LocationResponse>;
  remove: (id: string) => Promise<void>;
}

export const LOCATIONS_KEY = "locations";
const NO_LOCATIONS: LocationResponse[] = [];

/** The caller's own active saved places. The token is part of the key: another
 * account's places must never show, even briefly. `create` reuses an already
 * loaded active row with the same `google_place_id` instead of sending a request. */
export function useMyLocations(): UseMyLocationsResult {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [LOCATIONS_KEY, "mine", token],
    queryFn: getMyLocations,
    enabled: token !== null,
  });
  const { refetch: queryRefetch } = query;
  const locations = query.data ?? NO_LOCATIONS;

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: [LOCATIONS_KEY] }),
    [queryClient],
  );

  const create = useCallback(
    async (request: CreateLocationRequest) => {
      const placeId = request.google_place_id;
      const existing = placeId
        ? locations.find((l) => l.google_place_id === placeId && l.deleted_at === null)
        : undefined;
      if (existing) return existing;
      let created: LocationResponse;
      try {
        created = await apiCreateLocation(request);
      } catch (err) {
        throw new Error(extractProblemMessage(err));
      }
      await invalidate();
      return created;
    },
    [locations, invalidate],
  );

  const update = useCallback(
    async (id: string, request: UpdateLocationRequest) => {
      let updated: LocationResponse;
      try {
        updated = await apiUpdateLocation(id, request);
      } catch (err) {
        throw new Error(extractProblemMessage(err));
      }
      await invalidate();
      return updated;
    },
    [invalidate],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await apiDeleteLocation(id);
      } catch (err) {
        throw new Error(extractProblemMessage(err));
      }
      await invalidate();
    },
    [invalidate],
  );

  return {
    data: locations,
    loading: query.isPending,
    error: query.error ? extractProblemMessage(query.error) : null,
    refetch,
    create,
    update,
    remove,
  };
}
