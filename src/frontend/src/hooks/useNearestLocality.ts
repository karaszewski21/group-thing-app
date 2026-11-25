import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { getNearestLocality } from "../api/localities";
import type { Locality } from "../api/locations";
import { extractProblemMessage } from "../api/problem";
import { LOCALITIES_KEY } from "./useLocalitySearch";

export interface Coordinates {
  lat: number;
  lng: number;
}

interface UseNearestLocalityResult {
  /** `null` without a point, while loading and when no locality is near it. */
  data: Locality | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** The locality closest to `point` (the browser's geolocation); nothing is
 * requested without a point. */
export function useNearestLocality(point: Coordinates | null): UseNearestLocalityResult {
  const query = useQuery({
    queryKey: [...LOCALITIES_KEY, "nearest", point?.lat ?? null, point?.lng ?? null],
    queryFn: () => getNearestLocality(point?.lat ?? 0, point?.lng ?? 0),
    enabled: point !== null,
  });
  const { refetch: queryRefetch } = query;

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  return {
    data: point !== null ? (query.data ?? null) : null,
    loading: point !== null && query.isPending,
    error: point !== null && query.error ? extractProblemMessage(query.error) : null,
    refetch,
  };
}
