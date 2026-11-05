"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useAuth } from "../../auth/AuthContext";
import { ToastPill } from "../../components/shared/ToastPill";
import { PAGE_SHELL } from "../../components/shared/uiStyles";
import { useToast } from "../../components/shared/useToast";
import { useTermAccess } from "../../hooks/useTermAccess";
import { notFound } from "../../routing/navigation";
import { OrganizerThemeScope } from "../../theme/OrganizerThemeScope";
import { attendeeElementId } from "./components/termSectionTypes";
import { TermPageSkeleton } from "./components/TermPageSkeleton";
import { useJoinCodeLink } from "./hooks/useJoinCodeLink";
import { TermLoadError, TermPageContext, type TermPageValue } from "./TermPageContext";
import { TERM_LOAD_ERROR, resolveTermView, type TermContentView } from "./termViewState";
import { PrivateTermView } from "./views/PrivateTermView";

/** `/:slug/group/:groupId/term/:termId`: shows exactly one screen per
 * `resolveTermView` state. A caller allowed to see the term gets the blocks
 * passed as `children` (composed in the route's `page.tsx`), fed through
 * `TermPageContext`; the access-code flow (`#code=` link, code sheet, join)
 * lives in `useJoinCodeLink`. */
export function TermPage({ groupId, termId, children }: { groupId: string; termId: string; children: ReactNode }) {
  const { state, isStale, refetch, joinWithCode } = useTermAccess(groupId, termId);
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
      return notFound();
    case "error":
      throw new TermLoadError(TERM_LOAD_ERROR);
    case "content":
      return (
        <OrganizerThemeScope theme={view.group.organization}>
          <TermContent view={view} refetch={refetch} showToast={showToast}>
            {children}
          </TermContent>
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

function TermContent({
  view,
  refetch,
  showToast,
  children,
}: {
  view: TermContentView;
  refetch: () => Promise<void>;
  showToast: (message: string) => void;
  children: ReactNode;
}) {
  const { token, displayName } = useAuth();
  const isLoggedIn = Boolean(token);
  const [activePartyId, setActivePartyId] = useState<string | null>(null);

  function selectAttendee(partyId: string) {
    setActivePartyId(partyId);
    const entry = document.getElementById(attendeeElementId(partyId));
    entry?.scrollIntoView({ behavior: "smooth", block: "start" });
    entry?.focus({ preventScroll: true });
  }

  const value: TermPageValue = {
    view,
    isLoggedIn,
    displayName,
    refetch,
    showToast,
    activePartyId,
    selectAttendee,
  };
  return (
    <TermPageContext.Provider value={value}>
      <div className={PAGE_SHELL}>{children}</div>
    </TermPageContext.Provider>
  );
}
