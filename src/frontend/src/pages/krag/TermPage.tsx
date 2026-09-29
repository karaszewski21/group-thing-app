import { useParams } from "react-router-dom";
import { useTermAccess } from "../../hooks/useTermAccess";
import { PrivateGroupGate } from "./PrivateGroupGate";
import { PublicTermView } from "./PublicTermView";
import { resolveTermAccess } from "./termAccess";

/** Route element for `/:organizationSlug/grupa/:groupId/term/:termId`.
 * Whoever may see the content gets the term page; anyone else gets the
 * `PrivateGroupGate` for their server-resolved state. */
export function TermPage() {
  const params = useParams<{ groupId: string; termId: string }>();
  const { state, isStale, refetch } = useTermAccess(params.groupId ?? '', params.termId ?? '');

  if (state.status === "loading") return <>Wczytywanie...</>;
  // A missing circle and a mismatched / deleted term both surface as the
  // same 404 here, so the wording stays generic.
  if (state.status === "error") return <>Nie znaleziono</>;

  const access = resolveTermAccess(state.data, state.forToken !== null);
  if (access.kind === "view") {
    return (
      <PublicTermView
        group={access.group}
        isAttendingOnServer={access.isAttending}
        refetch={refetch}
      />
    );
  }

  // The gate was resolved for another token: wait for the current one's
  // answer rather than offer a step that may no longer apply.
  if (isStale && state.refreshError === null) return <>Wczytywanie...</>;

  return (
    <PrivateGroupGate
      groupId={params.groupId ?? ''}
      termId={params.termId ?? ''}
      group={access.group}
      gate={access.gate}
      refetch={refetch}
      refreshError={state.refreshError}
      stale={isStale}
    />
  );
}
