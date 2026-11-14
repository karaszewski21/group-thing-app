import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { getMajorTowns } from "../api/localities";
import type { Locality } from "../api/locations";
import { extractProblemMessage } from "../api/problem";
import { LOCALITIES_KEY } from "./useLocalitySearch";

interface UseMajorTownsResult {
  data: Locality[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const NO_TOWNS: Locality[] = [];

/** The larger towns of every voivodeship, by voivodeship then name. */
export function useMajorTowns(): UseMajorTownsResult {
  const query = useQuery({ queryKey: [...LOCALITIES_KEY, "major"], queryFn: getMajorTowns });
  const { refetch: queryRefetch } = query;

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  return {
    data: query.data ?? NO_TOWNS,
    loading: query.isPending,
    error: query.error ? extractProblemMessage(query.error) : null,
    refetch,
  };
}
