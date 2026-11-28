import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  getEmailPreferences,
  updateEmailPreference,
  type EmailPreferenceCategory,
  type EmailPreferencesResponse,
} from "../api/email";
import { extractProblemMessage, serverMessageOr } from "../api/problem";
import { useAuth } from "../auth/AuthContext";

/** Query-key prefix of the caller's email preferences. */
export const EMAIL_PREFERENCES_KEY = "emailPreferences";

const SAVE_FALLBACK = "Nie udało się zapisać zmiany. Spróbuj ponownie.";

interface UseEmailPreferencesResult {
  data: EmailPreferencesResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  /** Saves one switch; rejects with the server's Polish message or a fallback. */
  update: (category: EmailPreferenceCategory, enabled: boolean) => Promise<EmailPreferencesResponse>;
}

/** The caller's mail address state and notification switches. The token is
 * part of the key, so another account's settings never show. */
export function useEmailPreferences(): UseEmailPreferencesResult {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [EMAIL_PREFERENCES_KEY, token],
    queryFn: getEmailPreferences,
    enabled: token !== null,
  });
  const { refetch: queryRefetch } = query;

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  const update = useCallback(
    async (category: EmailPreferenceCategory, enabled: boolean) => {
      let saved: EmailPreferencesResponse;
      try {
        saved = await updateEmailPreference({ category, enabled });
      } catch (err) {
        throw new Error(serverMessageOr(err, SAVE_FALLBACK));
      }
      await queryClient.invalidateQueries({ queryKey: [EMAIL_PREFERENCES_KEY] });
      return saved;
    },
    [queryClient],
  );

  return {
    data: query.data ?? null,
    loading: token !== null && query.isPending,
    error: query.error ? extractProblemMessage(query.error) : null,
    refetch,
    update,
  };
}
