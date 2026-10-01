import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import type { PublicCircleResponse, PublicItemListingResponse } from "../../api/groups";
import type { ReservationType } from "../../api/reservations";
import { RsvpDialog } from "../../components/krag/RsvpDialog";
import { RsvpDialogLoggedIn } from "../../components/krag/RsvpDialogLoggedIn";
import { AuthGateSheet } from "../../components/krag/AuthGateSheet";
import { AccountMergeForm } from "../../components/krag/AccountMergeForm";
import { GroupVisualization } from "./GroupVisualization";
import { KragStage } from "./components/KragStage";
import { GroupHeader } from "./components/GroupHeader";
import { TermCard } from "./components/TermCard";
import { NeededItemsSection } from "./components/NeededItemsSection";
import { AttendeeList } from "./components/AttendeeList";
import { TermFooter } from "./components/TermFooter";
import { SwapProposeDialog } from "./components/SwapProposeDialog";
import { LISTABLE_RESERVATION_TYPES, TAKE_ACTION_LABELS } from "./components/termLabels";
import { attendeeElementId, type ListingRowVM, type NeededItemRowVM } from "./components/termSectionTypes";
import { buildAttendees, buildVisualizationFamilies } from "./termViewModel";
import { useToast } from "./hooks/useToast";
import { useGuestMerge } from "./hooks/useGuestMerge";
import { useTermSignUp } from "./hooks/useTermSignUp";
import { useNeededItemPledge } from "./hooks/useNeededItemPledge";
import { useItemTake } from "./hooks/useItemTake";

/** The term page's content, for a caller allowed to see it. */
export function PublicTermView({
  group,
  isAttendingOnServer,
  refetch,
}: {
  group: PublicCircleResponse;
  isAttendingOnServer: boolean;
  refetch: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const { token, displayName } = useAuth();
  const isLoggedIn = Boolean(token);
  const groupId = group.id;
  const term = group.term;
  const termId = term?.id ?? null;

  const [activePartyId, setActivePartyId] = useState<number | null>(null);
  const { toast, showToast } = useToast();
  const deps = { isLoggedIn, refetch, showToast };
  const guest = useGuestMerge({ groupId, termId, isLoggedIn, isAttendingOnServer });
  const signUp = useTermSignUp({ ...deps, groupId, termId, displayName });
  const pledge = useNeededItemPledge(deps);
  const itemTake = useItemTake({ ...deps, termId });

  function handleSelectAttendee(partyId: number) {
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
          to={`/product/${listing.item_id}`}
          className="text-inherit underline decoration-[1.5px] underline-offset-2 hover:text-mint"
        >
          <strong>{listing.product_name}</strong>
          <span aria-hidden="true"> ›</span>
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
    <KragStage
      overlay={
        <>
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
          {toast && (
            <div className="fixed bottom-[90px] left-1/2 z-[120] -translate-x-1/2 rounded-full bg-[#1E2E27] px-5 py-[11px] text-sm font-semibold text-[#EAF2E9] shadow-[0_14px_30px_-14px_rgba(30,46,39,.9)]" role="status">
              {toast}
            </div>
          )}
        </>
      }
    >
      <GroupHeader title={group.name} subtitle={term?.description ?? null} onBack={() => navigate(-1)} />

      <main className="kg-main">
        <GroupVisualization
          layoutMode={group.layout_mode}
          organizerName={group.organizer_display_name ?? ""}
          families={buildVisualizationFamilies(group)}
          activeFamilyId={activePartyId}
          neededItemRows={neededItemRows}
          onSelectFamily={handleSelectAttendee}
          groupId={groupId}
        />

        <TermCard date={term?.occurs_on ?? ''} />

        {neededItemRows.length > 0 && (
            <NeededItemsSection rows={neededItemRows}/>
        )}

        {term && <AttendeeList attendees={buildAttendees(group, toListingRow)} activePartyId={activePartyId} />}

        {signUp.accountSuggestion && (
          <div className="mx-4.5 mb-6 mt-4.5  rounded-[22px] border border-[#E2EADF] bg-white p-4.25">
            <h3 className="text-[15px]">Załóż konto, aby zachować dostęp</h3>
            <AccountMergeForm userProfileId={signUp.accountSuggestion.user_profile_id} />
            <button className="mt-2 rounded-full border-[1.5px] border-[#E2EADF] bg-transparent px-[14px] py-[7px] text-xs font-bold text-[#5C7069]" style={{ marginTop: 8 }} onClick={signUp.dismissSuggestion}>
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
    </KragStage>
  );
}
