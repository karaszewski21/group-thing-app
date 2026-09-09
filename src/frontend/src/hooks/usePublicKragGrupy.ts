import { useCallback, useEffect, useState } from "react";
import { getPublicCircle, type PublicCircleResponse } from "../api/groups";

interface UsePublicKragGrupyResult {
  loading: boolean;
  error: string | null;
  circle: PublicCircleResponse | null;
  refetch: () => Promise<void>;
}

/** Anonymous-safe sibling of `useKragGrupy` — calls only the PUBLIC
 * `getPublicCircle` endpoint, never `getMyProfile()` or any other
 * authenticated call (which would 401 a visitor with no token). The
 * backend assembles organizer/term/needed-items/guardians in one call,
 * so unlike `useKragGrupy` there is no client-side fan-out needed. */
export function usePublicKragGrupy(
  groupId: number,
  termId?: number,
): UsePublicKragGrupyResult {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [circle, setCircle] = useState<PublicCircleResponse | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCircle(await getPublicCircle(groupId, termId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udalo sie wczytac danych grupy");
    } finally {
      setLoading(false);
    }
  }, [groupId, termId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { loading, error, circle, refetch };
}
