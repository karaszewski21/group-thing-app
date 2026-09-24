import { useParams } from "react-router-dom";
import { useTermAccess } from "../../hooks/useTermAccess";
import { PrivateGroupGate } from "./PrivateGroupGate";
import { PublicTermView } from "./PublicTermView";
import { resolveTermAccess } from "./termAccess";
import { KragStageMessage } from "./components/KragStage";

/** Route element for `/:organizationSlug/grupa/:groupId/term/:termId`.
 * Whoever may see the content gets the term page; anyone else gets the
 * `PrivateGroupGate` for their server-resolved state. */
export function TermPage() {
  const params = useParams<{ groupId: string; termId: string }>();
  const groupId = Number(params.groupId);
  const termId = params.termId !== undefined ? Number(params.termId) : undefined;
  const { state, isStale, refetch } = useTermAccess(groupId, termId);

  if (state.status === "loading") return <KragStageMessage>Wczytywanie...</KragStageMessage>;
  // A missing circle and a mismatched / deleted term both surface as the
  // same 404 here, so the wording stays generic.
  if (state.status === "error") return <KragStageMessage>Nie znaleziono</KragStageMessage>;

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
  if (isStale && state.refreshError === null) return <KragStageMessage>Wczytywanie...</KragStageMessage>;

  return (
    <PrivateGroupGate
      groupId={groupId}
      termId={termId}
      group={access.group}
      gate={access.gate}
      refetch={refetch}
      refreshError={state.refreshError}
      stale={isStale}
    />
  );
}
