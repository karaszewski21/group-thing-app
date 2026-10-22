import { useCallback } from "react";
import { useParams } from "react-router-dom";
import { ToastPill } from "../../components/shared/ToastPill";
import { useToast } from "../../components/shared/useToast";
import { useTermAccess } from "../../hooks/useTermAccess";
import { OrganizerThemeScope } from "../../theme/OrganizerThemeScope";
import { TermPageSkeleton } from "./components/TermPageSkeleton";
import { useJoinCodeLink } from "./hooks/useJoinCodeLink";
import { resolveTermView } from "./termViewState";
import { PrivateTermView } from "./views/PrivateTermView";
import { PublicTermView } from "./views/PublicTermView";

/** Route element for `/:organizationSlug/grupa/:groupId/term/:termId`.
 * Shows exactly one view per `resolveTermView` state; the access-code flow
 * (`#code=` link, code sheet, join) lives in `useJoinCodeLink`. */
export function TermPage() {
  const params = useParams<{ groupId: string; termId: string }>();
  const groupId = params.groupId ?? "";
  const { state, isStale, refetch, joinWithCode } = useTermAccess(groupId, params.termId ?? "");
  const view = resolveTermView(state, isStale);
  const { toast, showToast } = useToast();
  const onJoined = useCallback(() => showToast("Dołączono do grupy"), [showToast]);
  const codeLink = useJoinCodeLink({
    groupId,
    view: view.kind,
    isStale,
    joinWithCode,
    onJoined,
  });

  switch (view.kind) {
    case "loading":
      return <TermPageSkeleton />;
    // A missing circle and a mismatched / deleted term are the same 404.
    case "notFound":
      return <>Nie znaleziono</>;
    case "content":
      return (
        <OrganizerThemeScope theme={view.group.organization}>
          <PublicTermView
            group={view.group}
            isAttendingOnServer={view.isAttending}
            chatAccess={view}
            refetch={refetch}
          />
          <ToastPill message={toast} />
        </OrganizerThemeScope>
      );
    default:
      return (
        <OrganizerThemeScope theme={view.group.organization}>
          <PrivateTermView
            view={view}
            onRetry={refetch}
            hasPendingCode={codeLink.hasPendingCode}
            codeSheet={codeLink.sheet}
            onOpenSheet={codeLink.openSheet}
            onCloseSheet={codeLink.closeSheet}
            onJoin={codeLink.join}
          />
        </OrganizerThemeScope>
      );
  }
}
