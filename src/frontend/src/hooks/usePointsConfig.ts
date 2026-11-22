import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { getPointsConfig, updatePointsConfig, type PointsConfig } from "../api/points";
import { extractProblemMessage } from "../api/problem";

/** Query-key prefix of every points read. */
export const POINTS_KEY = "points";
const POINTS_CONFIG_KEY = [POINTS_KEY, "config"] as const;

interface UsePointsConfigResult {
  data: PointsConfig | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  /** Saves the full config; rejects with the server's message (e.g. the 409 on a stale `updated_at`). */
  update: (request: PointsConfig) => Promise<PointsConfig>;
}

/** The admin points config (ADMIN only) and its save. */
export function usePointsConfig(): UsePointsConfigResult {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: POINTS_CONFIG_KEY, queryFn: getPointsConfig });
  const { refetch: queryRefetch } = query;

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  const update = useCallback(
    async (request: PointsConfig) => {
      let saved: PointsConfig;
      try {
        saved = await updatePointsConfig(request);
      } catch (err) {
        throw new Error(extractProblemMessage(err));
      }
      await queryClient.invalidateQueries({ queryKey: [POINTS_KEY] });
      return saved;
    },
    [queryClient],
  );

  return {
    data: query.data ?? null,
    loading: query.isPending,
    error: query.error ? extractProblemMessage(query.error) : null,
    refetch,
    update,
  };
}
