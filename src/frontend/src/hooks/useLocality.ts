import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { getLocality } from "../api/localities";
import type { Locality } from "../api/locations";
import { extractProblemMessage } from "../api/problem";
import { LOCALITIES_KEY } from "./useLocalitySearch";

interface UseLocalityResult {
  /** `null` without an id, while loading and for an unknown id. */
  data: Locality | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** One locality by its SIMC id (a `locality` kept in a URL); nothing is
 * requested without an id. */
export function useLocality(id: string | null): UseLocalityResult {
  const query = useQuery({
    queryKey: [...LOCALITIES_KEY, "by-id", id],
    queryFn: () => getLocality(id ?? ""),
    enabled: id !== null,
  });
  const { refetch: queryRefetch } = query;

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  return {
    data: id !== null ? (query.data ?? null) : null,
    loading: id !== null && query.isPending,
    error: id !== null && query.error ? extractProblemMessage(query.error) : null,
    refetch,
  };
}
