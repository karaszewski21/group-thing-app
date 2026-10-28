import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import type { PluginResponse } from "../api/plugins";
import { getPlugins } from "../api/plugins";
import { extractProblemMessage } from "../api/problem";

interface UsePluginsResult {
  data: PluginResponse[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export const PLUGINS_KEY = "plugins";
const NO_PLUGINS: PluginResponse[] = [];

/** Registered plugins for panel pages; the admin tree uses `PluginProvider`. */
export function usePlugins(): UsePluginsResult {
  const query = useQuery({ queryKey: [PLUGINS_KEY], queryFn: getPlugins });
  const { refetch: queryRefetch } = query;

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  return {
    data: query.data ?? NO_PLUGINS,
    loading: query.isPending,
    error: query.error ? extractProblemMessage(query.error) : null,
    refetch,
  };
}
