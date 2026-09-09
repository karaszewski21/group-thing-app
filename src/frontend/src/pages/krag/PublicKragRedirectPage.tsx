import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getPublicCircle } from "../../api/groups";
import { CSS, PublicKragGrupyView } from "./KragGrupyPage";

/* ------------------------------------------------------------------ */
/*  Term-less public resolver (spec §3.6). Fetches the circle with no   */
/*  term_id and canonicalizes to the per-term URL:                      */
/*    - nearest term present -> <Navigate replace> to /…/term/:id       */
/*    - zero terms           -> render PublicKragGrupyView in place      */
/*                              (its own `term === null` state)         */
/*    - unknown groupId (404) -> .kg-state "Nie znaleziono"             */
/*  Reuses the `.kg-*` shell so the redirect flash matches the          */
/*  destination page chrome. `:organizationSlug` is cosmetic — echoed   */
/*  straight back into the redirect target, never validated.            */
/* ------------------------------------------------------------------ */

type ResolveState = "loading" | "no-terms" | "not-found";

export function PublicKragRedirectPage() {
  const { organizationSlug, groupId } = useParams<{
    organizationSlug: string;
    groupId: string;
  }>();
  const navigate = useNavigate();
  const [state, setState] = useState<ResolveState>("loading");

  useEffect(() => {
    let cancelled = false;
    getPublicCircle(Number(groupId))
      .then((circle) => {
        if (cancelled) return;
        if (circle.next_term) {
          navigate(`/${organizationSlug}/grupa/${groupId}/term/${circle.next_term.id}`, {
            replace: true,
          });
        } else {
          setState("no-terms");
        }
      })
      .catch(() => {
        if (!cancelled) setState("not-found");
      });
    return () => {
      cancelled = true;
    };
  }, [organizationSlug, groupId, navigate]);

  if (state === "no-terms") {
    return <PublicKragGrupyView />;
  }

  if (state === "not-found") {
    return (
      <div className="kg-stage">
        <style>{CSS}</style>
        <div className="kg-app">
          <div className="kg-state">Nie znaleziono</div>
        </div>
      </div>
    );
  }

  return (
    <div className="kg-stage">
      <style>{CSS}</style>
      <div className="kg-app">
        <div className="kg-state" role="status" aria-label="Wczytywanie">
          Wczytywanie...
        </div>
      </div>
    </div>
  );
}
