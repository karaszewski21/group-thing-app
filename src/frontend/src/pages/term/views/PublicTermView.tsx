import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../../auth/AuthContext";
import type { PublicCircleResponse, PublicItemListingResponse } from "../../../api/groups";
import type { ReservationType } from "../../../api/reservations";
import { RsvpDialog } from "../modals/RsvpDialog";
import { RsvpDialogLoggedIn } from "../modals/RsvpDialogLoggedIn";
import { AuthGateSheet } from "../modals/AuthGateSheet";
import { AccountMergeForm } from "../modals/AccountMergeForm";
import { BTN_GHOST, BTN_SM, CARD, PAGE_SHELL } from "../../../components/shared/uiStyles";
import { ToastPill } from "../../../components/shared/ToastPill";
import { GroupVisualization } from "../components/GroupVisualization";
import { GroupHeader } from "../components/GroupHeader";
import { TermCard } from "../components/TermCard";
import { NeededItemsSection } from "../components/NeededItemsSection";
import { AttendeeList } from "../components/AttendeeList";
import { TermFooter } from "../components/TermFooter";
import { SwapProposeDialog } from "../modals/SwapProposeDialog";
import { TakeSuccessSheet } from "../modals/TakeSuccessSheet";
import { LISTABLE_RESERVATION_TYPES, TAKE_ACTION_LABELS } from "../components/termLabels";
import { attendeeElementId, type ListingRowVM, type NeededItemRowVM } from "../components/termSectionTypes";
import { buildAttendees, buildVisualizationFamilies } from "../termViewModel";
import { useToast } from "../../../components/shared/useToast";
import { useGuestMerge } from "../hooks/useGuestMerge";
import { useTermSignUp } from "../hooks/useTermSignUp";
import { useNeededItemPledge } from "../hooks/useNeededItemPledge";
import { useItemTake } from "../hooks/useItemTake";
import { organizerItemPath } from "../../product/useItemRoutes";
import { useOpenAndNavigate } from "../../../hooks/useOpenAndNavigate";

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
  const navigate = useNavigate();
  const { token, displayName } = useAuth();
  const isLoggedIn = Boolean(token);
  const groupId = group.id;
  const term = group.term;
  const termId = term?.id ?? null;

  const [activePartyId, setActivePartyId] = useState<string | null>(null);
  const { toast, showToast } = useToast();
  const deps = { isLoggedIn, refetch, showToast };
  const guest = useGuestMerge({ groupId, termId, isLoggedIn, isAttendingOnServer });
  const signUp = useTermSignUp({ ...deps, groupId, termId, displayName });
  const pledge = useNeededItemPledge(deps);
  const itemTake = useItemTake({ ...deps, termId });

  function handleSelectAttendee(partyId: string) {
    setActivePartyId(partyId);
    const entry = document.getElementById(attendeeElementId(partyId));
    entry?.scrollIntoView({ behavior: "smooth", block: "start" });
    entry?.focus({ preventScroll: true });
  }

  function toListingRow(listing: PublicItemListingResponse): ListingRowVM {
    const mergeKey = `listing-${listing.item_id}`;
    const offeredTypes = listing.offered_types.filter((t): t is ReservationType =>
      LISTABLE_RESERVATION_TYPES.includes(t as ReservationType),
    );
    return {
      key: listing.item_id,
      title: (
        <Link
          to={organizerItemPath(group.organizer_slug, listing.item_id)}
          className="rounded text-inherit no-underline decoration-[1.5px] underline-offset-2 hover:text-primary-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          <strong>{listing.product_name}</strong>
          <span aria-hidden="true">{" ›"}</span>
        </Link>
      ),
      actions: guest.isMerging(mergeKey)
        ? []
        : offeredTypes.map((t) => ({
            key: t,
            label: TAKE_ACTION_LABELS[t],
            ariaLabel: `${TAKE_ACTION_LABELS[t]}: ${listing.product_name}`,
            disabled: itemTake.busyItemId === listing.item_id,
            onClick: guest.orMerge(mergeKey, () => itemTake.take(listing.item_id, t)),
          })),
      extra: guest.mergeForm(mergeKey),
      thumbUrl: listing.thumb_url,
    };
  }

  const neededItemRows: NeededItemRowVM[] = (term?.needed_items ?? []).map((item) => {
    const mergeKey = `needed-${item.id}`;
    const pledgedHere = pledge.isPledgedHere(item.id);
    const claimed = item.claimed || pledgedHere;
    const claimedByMe = pledgedHere || (displayName !== null && item.claimed_by_name === displayName);
    return {
      key: item.id,
      title: (
        <strong>
          {item.product_name}
          {item.description ? ` — ${item.description}` : ""}
        </strong>
      ),
      subtitle: claimed ? `Przynosi: ${claimedByMe ? "Ty" : (item.claimed_by_name ?? "inna rodzina")}` : null,
      inlineActions:
        !claimed && !guest.isMerging(mergeKey)
          ? [
              {
                key: "pledge",
                label: "Ja to przyniosę",
                ariaLabel: `Ja to przyniosę: ${item.product_name}`,
                disabled: pledge.pledgingItemId === item.id,
                onClick: guest.orMerge(mergeKey, () => pledge.pledge(item.id)),
              },
            ]
          : [],
      extra: guest.mergeForm(mergeKey),
    };
  });

  return (
    <div className={PAGE_SHELL}>
      <GroupHeader
        title={group.name}
        subtitle={term?.description ?? null}
        onBack={() => navigate(-1)}
        organizerName={group.organizer_display_name}
        organizerSlug={group.organizer_slug}
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

        {term && <AttendeeList attendees={buildAttendees(group, toListingRow)} activePartyId={activePartyId} />}

        {signUp.accountSuggestion && (
          <div className={`${CARD} mx-5 mt-6`}>
            <h3 className="text-[15px] font-bold">Załóż konto, aby zachować dostęp</h3>
            <AccountMergeForm userProfileId={signUp.accountSuggestion.user_profile_id} />
            <button type="button" className={`${BTN_GHOST} ${BTN_SM} mt-2`} onClick={signUp.dismissSuggestion}>
              Może później
            </button>
          </div>
        )}
      </main>

      {term && (
        <TermFooter
          isLoggedIn={isLoggedIn}
          isAttending={guest.isAttending}
          busy={signUp.signingUp}
          onSignUp={signUp.openSignUp}
        />
      )}
      {signUp.gateOpen && (
        <AuthGateSheet
          title="Zapisz się na zajęcia"
          message="Zaloguj się, żeby zapis trafił na Twoje konto — albo zapisz się jako gość."
          onGuest={signUp.continueAsGuest}
          onClose={signUp.closeGate}
        />
      )}
      {signUp.dialogOpen &&
        term &&
        (isLoggedIn ? (
          <RsvpDialogLoggedIn
            groupId={groupId}
            termId={term.id}
            displayName={displayName}
            onClose={signUp.closeDialog}
            onSubmitted={signUp.handleSubmitted}
          />
        ) : (
          <RsvpDialog
            groupId={groupId}
            termId={term.id}
            onClose={signUp.closeDialog}
            onSubmitted={signUp.handleSubmitted}
          />
        ))}
      {pledge.gateOpen && (
        <AuthGateSheet
          title="Potrzebne konto"
          message="Żeby zgłosić, że przyniesiesz coś na zajęcia, musisz mieć konto — dzięki temu organizator wie, kto co przynosi, a rzecz trafia do Twoich zbiorów."
          ariaLabel="Załóż konto, aby przynieść rzecz"
          onClose={pledge.closeGate}
        />
      )}
      {itemTake.gateOpen && (
        <AuthGateSheet
          title="Potrzebne konto"
          message="Żeby wziąć, pożyczyć albo zamienić się rzeczą, musisz mieć konto — dzięki temu wiadomo, kto co bierze, a rzecz trafia do Twoich zbiorów."
          ariaLabel="Załóż konto, aby wziąć rzecz"
          onClose={itemTake.closeGate}
        />
      )}
      {itemTake.swap.itemId !== null &&
        (() => {
          const listing = term?.item_listings.find((l) => l.item_id === itemTake.swap.itemId);
          return listing ? (
            <SwapProposeDialog
              availableItems={itemTake.swap.availableItems}
              offeredItemId={itemTake.swap.offeredItemId}
              onOfferedItemChange={itemTake.swap.setOfferedItemId}
              listingProductName={listing.product_name}
              busy={itemTake.busyItemId === listing.item_id}
              onConfirm={() => itemTake.swap.confirm(listing.item_id)}
              onCancel={itemTake.swap.cancel}
            />
          ) : null;
        })()}
      {itemTake.takeSuccess && term && (
        <TakeSuccessSheet
          itemId={itemTake.takeSuccess.itemId}
          itemName={itemTake.takeSuccess.itemName}
          occursOn={term.occurs_on}
          groupName={group.name}
          groupId={groupId}
          termId={term.id}
          organizerSlug={group.organizer_slug ?? "krag"}
          onClose={itemTake.closeTakeSuccess}
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
