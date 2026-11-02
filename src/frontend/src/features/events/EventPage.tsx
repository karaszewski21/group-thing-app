"use client";

import { useEffect, type ReactNode } from "react";
import { useAppNavigate, useAppParams, useNavigationState } from "../../routing/navigation";
import type { EventDetailResponse } from "../../api/events";
import { useAuth } from "../../auth/AuthContext";
import { ConfirmDeleteDialog } from "../../components/shared/ConfirmDeleteDialog";
import { ToastPill } from "../../components/shared/ToastPill";
import { useToast } from "../../components/shared/useToast";
import { PAGE_SHELL } from "../../components/shared/uiStyles";
import { useEvent } from "../../hooks/useEvent";
import { useOpenAndNavigate } from "../../hooks/useOpenAndNavigate";
import { useOrigin } from "../../lib/useClientValue";
import { OrganizerThemeScope } from "../../theme/OrganizerThemeScope";
import { eventPath, viewPath } from "../../routing/paths";
import { GroupHeader } from "../terms/components/GroupHeader";
import { TermPageSkeleton } from "../terms/components/TermPageSkeleton";
import { EventAttendeeList } from "./components/EventAttendeeList";
import { EventAuthorCard } from "./components/EventAuthorCard";
import { EventChatRow } from "./components/EventChatRow";
import { EventFooter } from "./components/EventFooter";
import { EventGuestMergeCard } from "./components/EventGuestMergeCard";
import { EventGuestSignUpSheet } from "./components/EventGuestSignUpSheet";
import { EventWhenCard } from "./components/EventWhenCard";
import { resolveEventView } from "./eventViewState";
import { useEventSignUp } from "./hooks/useEventSignUp";

const RETRY_BUTTON =
  "mt-3 rounded-xl border border-line bg-paper px-4 py-2 text-[13px] font-semibold text-ink hover:bg-cream";

/** A toast handed over in router state, e.g. by the create flow. */
function routerToast(state: unknown): string | null {
  return typeof state === "object" && state !== null && "toast" in state && typeof state.toast === "string"
    ? state.toast
    : null;
}

/** Route element for `/:organizationSlug/event/:eventId`: the public page of
 * a one-off event. Keyed on the id, since React Router reuses the element
 * when only `:eventId` changes and the page state belongs to one event. */
export function EventPage() {
  const { eventId = "" } = useAppParams();
  return <EventPageContent key={eventId} eventId={eventId} />;
}

/** Shows exactly one view per `resolveEventView` state; sign-up and withdraw
 * live in `useEventSignUp`. */
function EventPageContent({ eventId }: { eventId: string }) {
  const { token } = useAuth();
  const isLoggedIn = Boolean(token);
  const navigate = useAppNavigate();
  const state = useNavigationState<unknown>();
  const event = useEvent(eventId);
  const { toast, showToast } = useToast();
  const chat = useOpenAndNavigate();
  const signUp = useEventSignUp({
    eventId,
    isLoggedIn,
    signUp: event.signUp,
    withdraw: event.withdraw,
    showToast,
  });
  const view = resolveEventView({
    data: event.data,
    loading: event.loading,
    notFound: event.notFound,
    error: event.error,
    isStale: event.isStale,
    isLoggedIn,
    guestProfileId: signUp.guestProfileId,
  });

  // Shown once: the handed-over state is read once, so a refresh or a back
  // navigation doesn’t repeat it.
  const handedOverToast = routerToast(state);
  useEffect(() => {
    if (handedOverToast === null) return;
    showToast(handedOverToast);
  }, [handedOverToast, showToast]);

  const page = (content: EventDetailResponse, sections: Omit<EventShellProps, "event" | "onCopyLink">) => (
    <EventShell event={content} onCopyLink={() => showToast("Skopiowano link")} {...sections} />
  );
  const chatRow = (id: string) => (
    <EventChatRow onOpen={() => void chat.open({ kind: "EVENT", id })} busy={chat.busy} error={chat.error} />
  );

  const body = (() => {
    switch (view.kind) {
      case "loading":
        return <TermPageSkeleton />;
      case "notFound":
        return <p className="px-5 pt-6 text-[12.5px] text-ink-soft">Nie znaleziono wydarzenia.</p>;
      case "error":
        return (
          <div className="px-5 pt-6">
            <p role="alert" className="text-[12.5px] font-semibold text-danger">
              Nie udało się wczytać wydarzenia — {view.message}
            </p>
            <button type="button" onClick={() => void event.refetch()} className={RETRY_BUTTON}>
              Spróbuj ponownie
            </button>
          </div>
        );
      case "refreshing":
        return page(view.event, {
          card: view.error && (
            <div className="mx-5 mt-6">
              <p role="alert" className="text-[12.5px] font-semibold text-danger">
                Nie udało się odświeżyć wydarzenia — {view.error}
              </p>
              <button type="button" onClick={() => void event.refetch()} className={RETRY_BUTTON}>
                Spróbuj ponownie
              </button>
            </div>
          ),
        });
      case "author":
        return page(view.event, {
          chat: chatRow(view.event.id),
          card: (
            <EventAuthorCard
              event={view.event}
              onDelete={async () => {
                await event.remove();
                navigate(viewPath("meetings"));
              }}
            />
          ),
        });
      case "attendee":
        return page(view.event, {
          chat: chatRow(view.event.id),
          footer: view.ended ? (
            <EventFooter variant="ended" />
          ) : (
            <EventFooter variant="withdraw" busy={false} onWithdraw={signUp.openWithdraw} />
          ),
          overlay: signUp.confirmingWithdraw && (
            <ConfirmDeleteDialog
              title="Wypisać się z wydarzenia?"
              body="Znikniesz z listy zapisanych i stracisz dostęp do czatu wydarzenia."
              confirmLabel="Wypisz się"
              tone="primary"
              busyLabel="Wypisywanie…"
              fallbackError="Nie udało się wypisać. Spróbuj ponownie."
              onConfirm={signUp.confirmWithdraw}
              onClose={signUp.closeWithdraw}
            />
          ),
        });
      case "guestAttendee":
        return page(view.event, { card: <EventGuestMergeCard guestProfileId={view.guestProfileId} /> });
      case "visitor":
        return page(view.event, {
          canSignUp: !view.ended,
          footer: view.ended ? (
            <EventFooter variant="ended" />
          ) : (
            <EventFooter variant="signUp" busy={signUp.signingUp} onSignUp={signUp.openSignUp} />
          ),
          overlay: signUp.sheetOpen && (
            <EventGuestSignUpSheet event={view.event} onSubmit={signUp.submitGuest} onClose={signUp.closeSheet} />
          ),
        });
    }
  })();

  return (
    <>
      {body}
      <ToastPill message={toast} />
    </>
  );
}

interface EventShellProps {
  event: EventDetailResponse;
  onCopyLink: () => void;
  /** The viewer may sign up, so the empty attendee list invites them to. */
  canSignUp?: boolean;
  /** The per-view parts, in page order; omitted ones render nothing. */
  chat?: ReactNode;
  card?: ReactNode;
  footer?: ReactNode;
  /** A sheet or dialog over the page. */
  overlay?: ReactNode;
}

/** The event page in the author's theme: header, banner, date and place,
 * description, chat, the attendee list, the view's card and footer. */
function EventShell({ event, onCopyLink, canSignUp = false, chat, card, footer, overlay }: EventShellProps) {
  const navigate = useAppNavigate();
  const origin = useOrigin();

  return (
    <OrganizerThemeScope theme={event.organization}>
      <div className={PAGE_SHELL}>
        <GroupHeader
          title={event.name}
          eyebrow="Wydarzenie"
          onBack={() => navigate(-1)}
          organizerName={event.author_display_name}
          // A `k-…` fallback slug has no organizer page: an author without an
          // Organization links to their person profile instead.
          organizerSlug={
            event.organization !== null
              ? event.author_slug
              : (event.participants.find((p) => p.is_author)?.party_id ?? null)
          }
        />
        <main tabIndex={-1} className="flex-1 pb-6 outline-none">
          {event.banner_url && (
            <img
              src={event.banner_url}
              alt={`Baner wydarzenia ${event.name}`}
              className="mx-5 block aspect-16/7 w-[calc(100%-2.5rem)] rounded-[22px] object-cover"
            />
          )}
          <EventWhenCard
            event={event}
            url={`${origin}${eventPath(event.author_slug, event.id)}`}
            onCopyLink={onCopyLink}
          />
          {event.description && (
            <p className="mx-5 mt-5 text-[15px] leading-relaxed whitespace-pre-line wrap-break-word text-ink">
              {event.description}
            </p>
          )}
          {chat}
          <EventAttendeeList
            participants={event.participants}
            authorSlug={event.author_slug}
            canSignUp={canSignUp}
          />
          {card}
        </main>
        {footer}
        {overlay}
      </div>
    </OrganizerThemeScope>
  );
}
