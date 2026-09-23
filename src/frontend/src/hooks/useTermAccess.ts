import { useCallback, useEffect, useState } from "react";
import { getGroupAccess, type GroupAccessResponse } from "../api/groups";
import { useAuth } from "../auth/AuthContext";

interface UseTermAccessResult {
  loading: boolean;
  error: string | null;
  data: GroupAccessResponse | null;
  refetch: () => Promise<void>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Nie udało się wczytać danych grupy";
}

/** The term page's single data source: the Circle's public view plus the
 * caller's resolved access (`is_attending` included), from `getGroupAccess`.
 * Re-fetches whenever the auth token changes, so an in-page login (e.g.
 * `AccountMergeForm`) immediately re-renders the page as that user. A
 * refetch keeps the previous data on screen instead of flashing a loader. */
export function useTermAccess(groupId: number, termId?: number): UseTermAccessResult {
  const { token } = useAuth();
  const [data, setData] = useState<GroupAccessResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => getGroupAccess(groupId, termId), [groupId, termId]);

  useEffect(() => {
    let cancelled = false;
    load().then(
      (response) => {
        if (cancelled) return;
        setData(response);
        setError(null);
      },
      (err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [load, token]);

  const refetch = useCallback(async () => {
    try {
      setData(await load());
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [load]);

  return { loading: data === null && error === null, error, data, refetch };
}
