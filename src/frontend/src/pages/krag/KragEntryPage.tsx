import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getMembershipsForFamily, getMyFamilies } from "../../api/families";
import { getMyProfile } from "../../api/people";

/**
 * Resolves the current guardian's active Circle membership and redirects to
 * `/krag/:groupId` — there is no group-context switcher (ADR-004 in the
 * research task's decision-log explicitly defers that), so if a family has
 * more than one active membership, the first one wins.
 */
export function KragEntryPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const resolveAndRedirect = useCallback(async () => {
    try {
      await getMyProfile();
      const myFamilies = await getMyFamilies();
      const myFamily = myFamilies[0] ?? null;
      if (!myFamily) {
        setError("Nie należysz jeszcze do żadnej rodziny w tej aplikacji.");
        return;
      }
      const memberships = await getMembershipsForFamily(myFamily.id);
      const active = memberships.find((m) => m.valid_to === null);
      if (!active) {
        setError("Nie jesteś jeszcze w żadnej grupie zajęciowej.");
        return;
      }
      navigate(`/krag/${active.to_group_id}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się wczytać grupy.");
    }
  }, [navigate]);

  useEffect(() => {
    // One-time resolve-then-redirect on mount, same `void asyncFn()` shape as
    // ProductDetailPage's `loadProduct` — the stricter compiler-based lint
    // rule flags this one specifically because of the conditional early
    // returns inside the try block (each guarding a redirect), not because
    // of an actual synchronous setState call.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void resolveAndRedirect();
  }, [resolveAndRedirect]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-6 font-sans text-ink">
      {error ? (
        <div className="w-full max-w-[360px] rounded-[22px] border border-line bg-paper p-8 text-center">
          <h1 className="font-serif text-lg font-semibold text-ink">Krąg grupy</h1>
          <p className="mt-2 text-sm text-ink-soft">{error}</p>
        </div>
      ) : (
        <div
          className="h-10 w-10 animate-spin rounded-full border-[3px] border-mint-soft border-t-mint"
          role="status"
          aria-label="Wczytywanie"
        />
      )}
    </div>
  );
}
