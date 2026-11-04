import { useState } from "react";
import { useAppNavigate } from "../../../routing/navigation";
import { useAuth } from "../../../auth/AuthContext";
import type { PublicCircleResponse } from "../../../api/groups";
import { RsvpDialogLoggedIn } from "../modals/RsvpDialogLoggedIn";
import { AuthSheet } from "../../auth/AuthSheet";
import { PAGE_SHELL } from "../../../components/shared/uiStyles";
import { ToastPill } from "../../../components/shared/ToastPill";
import { GroupVisualization } from "../components/GroupVisualization";
import { GroupHeader } from "../components/GroupHeader";
import { TermCard } from "../components/TermCard";
import { NeededItemsSection } from "../components/NeededItemsSection";
import { AttendeeList } from "../components/AttendeeList";
import { TermFooter } from "../components/TermFooter";
import { attendeeElementId, type NeededItemRowVM } from "../components/termSectionTypes";
import { buildAttendees, buildVisualizationFamilies } from "../termViewModel";
import { useToast } from "../../../components/shared/useToast";
import { useTermSignUp } from "../hooks/useTermSignUp";
import { useNeededItemPledge } from "../hooks/useNeededItemPledge";
import { useOpenAndNavigate } from "../../../hooks/useOpenAndNavigate";

/** The header chip's target: the Organization's page, else, for a PUBLIC
 * circle, the organizer's person profile (a `k-…` slug has no page). */
function organizerPageSegment(group: PublicCircleResponse): string | null {
  if (group.organization !== null) return group.organizer_slug;
  return group.visibility === "PUBLIC" ? group.organizer_party_id : null;
}

/** The server's chat-relevant relationship to the group and the shown term. */
interface ChatAccess {
  isOrganizer: boolean;
  isMember: boolean;
  isActiveAttendee: boolean;
}

/** The term page's content, for a caller allowed to see it. */
export function PublicTermView({
  group,
  isAttendingOnServer,
  chatAccess,
  refetch,
}: {
  group: PublicCircleResponse;
  isAttendingOnServer: boolean;
  chatAccess: ChatAccess;
  refetch: () => Promise<void>;
}) {
  const navigate = useAppNavigate();
  const { token, displayName } = useAuth();
  const isLoggedIn = Boolean(token);
  const groupId = group.id;
  const term = group.term;
  const termId = term?.id ?? null;

  const [activePartyId, setActivePartyId] = useState<string | null>(null);
  const { toast, showToast } = useToast();
  const deps = { isLoggedIn, refetch, showToast };
  const signUp = useTermSignUp({ ...deps, groupId, termId, displayName });
  const pledge = useNeededItemPledge(deps);

  function handleSelectAttendee(partyId: string) {
    setActivePartyId(partyId);
    const entry = document.getElementById(attendeeElementId(partyId));
    entry?.scrollIntoView({ behavior: "smooth", block: "start" });
    entry?.focus({ preventScroll: true });
  }

  const neededItemRows: NeededItemRowVM[] = (term?.needed_items ?? []).map((item) => {
    const pledgedHere = pledge.isPledgedHere(item.id);
    const claimed = item.claimed || pledgedHere;
    const claimedByMe = pledgedHere || (displayName !== null && item.claimed_by_name === displayName);
    return {
      key: item.id,
      title: (
        <strong>
          {item.name}
          {item.description ? ` — ${item.description}` : ""}
        </strong>
      ),
      subtitle: claimed ? `Przynosi: ${claimedByMe ? "Ty" : (item.claimed_by_name ?? "inna rodzina")}` : null,
      inlineActions: !claimed
        ? [
            {
              key: "pledge",
              label: "Ja to przyniosę",
              ariaLabel: `Ja to przyniosę: ${item.name}`,
              disabled: pledge.pledgingItemId === item.id,
              onClick: () => pledge.pledge(item.id),
            },
          ]
        : [],
    };
  });

  return (
    <div className={PAGE_SHELL}>
      <GroupHeader
        title={group.name}
        subtitle={term?.description ?? null}
        onBack={() => navigate(-1)}
        organizerName={group.organizer_display_name}
        organizerSlug={organizerPageSegment(group)}
      />

      <main tabIndex={-1} className="flex-1 outline-none">
        <section aria-label="Krąg zajęć" className="mx-5 rounded-[30px] bg-primary-soft pb-4">
          <GroupVisualization
            layoutMode={group.layout_mode}
            organizerName={group.organizer_display_name ?? ""}
            families={buildVisualizationFamilies(group)}
            activeFamilyId={activePartyId}
            neededItemRows={neededItemRows}
            onSelectFamily={handleSelectAttendee}
            groupId={groupId}
          />
        </section>

        <TermCard
          date={term?.occurs_on ?? ""}
          location={term?.location ?? null}
          capacity={term?.capacity ?? null}
          attendeeCount={term?.attendee_count}
        />

        <ChatRow
          showTermChat={termId !== null && isLoggedIn && (chatAccess.isActiveAttendee || chatAccess.isOrganizer)}
          showGroupChat={
            isLoggedIn && group.visibility === "PRIVATE" && (chatAccess.isMember || chatAccess.isOrganizer)
          }
          termId={termId}
          groupId={groupId}
        />

        {term && <NeededItemsSection rows={neededItemRows} />}

        {term && <AttendeeList attendees={buildAttendees(group)} activePartyId={activePartyId} />}
      </main>

      {term && (
        <TermFooter
          isLoggedIn={isLoggedIn}
          isAttending={isAttendingOnServer}
          busy={signUp.signingUp}
          onSignUp={signUp.openSignUp}
        />
      )}
      {signUp.gateOpen && (
        <AuthSheet
          title="Zapisz się na zajęcia"
          message="Zapisy na zajęcia wymagają konta. Zaloguj się albo załóż konto — zostaniesz na tej stronie."
          onClose={signUp.closeGate}
        />
      )}
      {signUp.dialogOpen && term && isLoggedIn && (
        <RsvpDialogLoggedIn
          groupId={groupId}
          termId={term.id}
          displayName={displayName}
          onClose={signUp.closeDialog}
          onSubmitted={signUp.handleSubmitted}
        />
      )}
      {pledge.gateOpen && (
        <AuthSheet
          message="Żeby zgłosić, że przyniesiesz coś na zajęcia, musisz mieć konto — dzięki temu organizator wie, kto co przynosi, a rzecz trafia do Twoich zbiorów."
          onClose={pledge.closeGate}
        />
      )}
      <ToastPill message={toast} />
    </div>
  );
}

const CHAT_BUTTON =
  "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full border-[1.5px] border-line bg-paper px-3 text-[13px] font-extrabold text-ink hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-60";

/** "Czat terminu" / "Czat grupy" between the term card and the lists. Gated
 * by the caller on server flags only; opens (or creates) the chat and goes to
 * its thread, or shows the error inline. */
function ChatRow({
  showTermChat,
  showGroupChat,
  termId,
  groupId,
}: {
  showTermChat: boolean;
  showGroupChat: boolean;
  termId: string | null;
  groupId: string;
}) {
  const { open, busy, error } = useOpenAndNavigate();
  if (!showTermChat && !showGroupChat) return null;

  return (
    <div className="mx-5 mt-3">
      <div className="flex gap-2">
        {showTermChat && (
          <button
            type="button"
            className={CHAT_BUTTON}
            disabled={busy}
            onClick={() => void open({ kind: "TERM", id: termId ?? "" })}
          >
            <span aria-hidden="true">💬</span> Czat terminu
          </button>
        )}
        {showGroupChat && (
          <button
            type="button"
            className={CHAT_BUTTON}
            disabled={busy}
            onClick={() => void open({ kind: "GROUP", id: groupId })}
          >
            <span aria-hidden="true">👥</span> Czat grupy
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-xs font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
