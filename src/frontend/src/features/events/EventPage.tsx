"use client";

import { useEffect, type ReactNode } from "react";
import { useAuth } from "../../auth/AuthContext";
import { ToastPill } from "../../components/shared/ToastPill";
import { PAGE_SHELL } from "../../components/shared/uiStyles";
import { useToast } from "../../components/shared/useToast";
import { useEvent } from "../../hooks/useEvent";
import { notFound, useNavigationState } from "../../routing/navigation";
import { OrganizerThemeScope } from "../../theme/OrganizerThemeScope";
import { TermPageSkeleton } from "../terms/components/TermPageSkeleton";
import { EventLoadError, EventPageContext, type EventPageValue } from "./EventPageContext";
import { resolveEventView } from "./eventViewState";

/** A toast handed over in router state, e.g. by the create flow. */
function routerToast(state: unknown): string | null {
  return typeof state === "object" && state !== null && "toast" in state && typeof state.toast === "string"
    ? state.toast
    : null;
}

/** `/:slug/event/:eventId`, the public page of a one-off event: shows exactly
 * one screen per `resolveEventView` state and gives the blocks passed as
 * `children` (composed in the route's `page.tsx`) their data through
 * `EventPageContext`. */
export function EventPage({ eventId, children }: { eventId: string; children: ReactNode }) {
  const isLoggedIn = Boolean(useAuth().token);
  const state = useNavigationState<unknown>();
  const event = useEvent(eventId);
  const { toast, showToast } = useToast();
  const view = resolveEventView({
    data: event.data,
    loading: event.loading,
    notFound: event.notFound,
    error: event.error,
    isStale: event.isStale,
    isLoggedIn,
  });

  // Shown once: the handed-over state is read once, so a refresh or a back
  // navigation doesn’t repeat it.
  const handedOverToast = routerToast(state);
  useEffect(() => {
    if (handedOverToast === null) return;
    showToast(handedOverToast);
  }, [handedOverToast, showToast]);

  switch (view.kind) {
    case "loading":
      return <TermPageSkeleton />;
    case "notFound":
      return notFound();
    case "error":
      throw new EventLoadError(view.message);
    default: {
      const value: EventPageValue = { view, actions: event, isLoggedIn, showToast };
      return (
        <EventPageContext.Provider value={value}>
          <OrganizerThemeScope theme={view.event.organization}>
            <div className={PAGE_SHELL}>{children}</div>
          </OrganizerThemeScope>
          <ToastPill message={toast} />
        </EventPageContext.Provider>
      );
    }
  }
}
