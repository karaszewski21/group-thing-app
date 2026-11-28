import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { getAppSettings, updateAppSettings, type AppSettingsResponse } from "../api/settings";
import { extractProblemMessage } from "../api/problem";

/** Query-key prefix of every app settings read. */
export const APP_SETTINGS_KEY = "app-settings";
const APP_SETTINGS_QUERY_KEY = [APP_SETTINGS_KEY] as const;

interface UseAppSettingsResult {
  data: AppSettingsResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  /** Saves the settings; rejects with the server's message (e.g. the 409 on a stale `updated_at`). */
  update: (request: AppSettingsResponse) => Promise<AppSettingsResponse>;
}

/** The admin app settings (ADMIN only) and their save. */
export function useAppSettings(): UseAppSettingsResult {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: APP_SETTINGS_QUERY_KEY, queryFn: getAppSettings });
  const { refetch: queryRefetch } = query;

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  const update = useCallback(
    async (request: AppSettingsResponse) => {
      let saved: AppSettingsResponse;
      try {
        saved = await updateAppSettings(request);
      } catch (err) {
        throw new Error(extractProblemMessage(err));
      }
      await queryClient.invalidateQueries({ queryKey: [APP_SETTINGS_KEY] });
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
