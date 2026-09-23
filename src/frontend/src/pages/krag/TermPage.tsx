import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { gateAction } from "../../utils/actionGate";
import { useTermAccess } from "../../hooks/useTermAccess";
import { useAuth } from "../../auth/AuthContext";
import { getInventories, getInventoryItemBalance, getInventoryItems } from "../../api/inventories";
import { createPledge } from "../../api/pledges";
import { getMyItemListingPreferences } from "../../api/itemListingPreferences";
import { getMyProfile } from "../../api/people";
import { getProducts } from "../../api/products";
import { ApiError } from "../../api/client";
import {
  guestProfileIdKey,
  readValidGuestProfile,
  type PublicCircleResponse,
  type PublicItemListingResponse,
  type RsvpResponse,
} from "../../api/groups";
import type { ReservationType } from "../../api/reservations";
import { proposeSwap, takeTermItemListing } from "../../api/termItemListings";
import { RsvpDialog } from "../../components/krag/RsvpDialog";
import { RsvpDialogLoggedIn } from "../../components/krag/RsvpDialogLoggedIn";
import { AuthGateSheet } from "../../components/krag/AuthGateSheet";
import { AccountMergeForm } from "../../components/krag/AccountMergeForm";
import { PrivateGroupAccessDenied } from "./PrivateGroupAccessDenied";
import { GroupVisualization, type VisualizationFamily } from "./GroupVisualization";
import { KragStage, KragStageMessage } from "./components/KragStage";
import { GroupHeader } from "./components/GroupHeader";
import { TermCard } from "./components/TermCard";
import { NeededItemsSection } from "./components/NeededItemsSection";
import { AttendeeList, type AttendeeVM } from "./components/AttendeeList";
import { TermFooter } from "./components/TermFooter";
import { SwapProposeDialog, type AvailableItem } from "./components/SwapProposeDialog";
import { LISTABLE_RESERVATION_TYPES, TAKE_ACTION_LABELS } from "./components/termLabels";
import { attendeeElementId, type ListingRowVM, type NeededItemRowVM } from "./components/termSectionTypes";

/** Class date + wall-clock start time for display. `occurs_on` is an ISO
 * datetime; a bare-date fallback (no time part) shows just the date. */
function formatTermWhen(iso: string): { date: string; time: string } {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("pl-PL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const t = iso.slice(11, 16);
  const time = /^\d{2}:\d{2}$/.test(t) && t !== "00:00" ? t : "";
  return { date, time };
}

/** Route element for `/:organizationSlug/grupa/:groupId/term/:termId`. A
 * `PRIVATE` group renders `PrivateGroupAccessDenied`; a `PUBLIC` one the
 * term page. */
export function TermPage() {
  const params = useParams<{ groupId: string; termId: string }>();
  const { token } = useAuth();
  const groupId = Number(params.groupId);
  const termId = params.termId !== undefined ? Number(params.termId) : undefined;
  const { loading, error, data, refetch } = useTermAccess(groupId, termId);

  if (loading) return <KragStageMessage>Wczytywanie...</KragStageMessage>;
  // A missing circle and a mismatched / deleted term both surface as the
  // same 404 here, so the wording stays generic.
  if (error || !data) return <KragStageMessage>Nie znaleziono</KragStageMessage>;

  if (data.group.visibility === "PRIVATE") {
    return (
      <PrivateGroupAccessDenied
        groupId={groupId}
        group={data.group}
        canJoin={data.access.can_join}
        isLoggedIn={Boolean(token)}
        onJoined={() => void refetch()}
      />
    );
  }

  return (
    <PublicTermView
      groupId={groupId}
      circle={data.group}
      isAttendingOnServer={data.access.is_attending}
      refetch={refetch}
    />
  );
}

/** Everyone in the attendee list: the Term's guardians first, then any
 * lister who offers items without being signed up (e.g. the organizer). */
function buildAttendees(
  circle: PublicCircleResponse,
  toRow: (listing: PublicItemListingResponse) => ListingRowVM,
): AttendeeVM[] {
  const listings = circle.next_term?.item_listings ?? [];
  const people = new Map<number, string>(circle.guardians.map((g) => [g.party_id, g.display_name]));
  for (const listing of listings) {
    if (!people.has(listing.lister_party_id)) people.set(listing.lister_party_id, listing.lister_display_name);
  }
  return Array.from(people, ([partyId, name]) => ({
    partyId,
    name,
    listings: listings.filter((l) => l.lister_party_id === partyId).map(toRow),
  }));
}

function PublicTermView({
  groupId,
  circle,
  isAttendingOnServer,
  refetch,
}: {
  groupId: number;
  circle: PublicCircleResponse;
  isAttendingOnServer: boolean;
  refetch: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const { token, displayName } = useAuth();
  const isLoggedIn = Boolean(token);
  const term = circle.next_term;

  const [activePartyId, setActivePartyId] = useState<number | null>(null);
  const [toast, setToast] = useState("");

  // ---- sign-up (footer) ----
  // Anonymous visitors first choose: log in / register, or continue as a
  // guest (`AuthGateSheet` with `onGuest`). Logged-in users go straight to
  // the logged-in dialog.
  const [showRsvpGate, setShowRsvpGate] = useState(false);
  const [showRsvpDialog, setShowRsvpDialog] = useState(false);
  // The RSVP just submitted this session — drives the post-guest-RSVP
  // account suggestion (only when `attached_to_account === false`).
  const [lastRsvp, setLastRsvp] = useState<RsvpResponse | null>(null);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);

  // ---- "Ja to przyniosę" (needed items) ----
  const [showPledgeGate, setShowPledgeGate] = useState(false);
  const [pledgedItemIds, setPledgedItemIds] = useState<number[]>([]);
  const [pledgingItemId, setPledgingItemId] = useState<number | null>(null);

  // ---- "Pożycz" / "Zamień" / "Weź na stałe" (attendee items) ----
  const [showTakeGate, setShowTakeGate] = useState(false);
  const [takingItemId, setTakingItemId] = useState<number | null>(null);
  const [takeOfferedItemId, setTakeOfferedItemId] = useState<number | null>(null);
  const [busyTakeItemId, setBusyTakeItemId] = useState<number | null>(null);
  const [myAvailableItems, setMyAvailableItems] = useState<AvailableItem[] | null>(null);

  // A guest who already RSVP'd has no account to ask the server about — an
  // unexpired `guest_profile_id:<groupId>:<termId>` key is their proof of
  // sign-up, and lets them turn the guest profile into an account in place
  // (`AccountMergeForm`) instead of seeing the login gate.
  const guestProfileId =
    !isLoggedIn && term ? readValidGuestProfile(guestProfileIdKey(groupId, term.id)) : null;
  const isAttending = isLoggedIn ? isAttendingOnServer : guestProfileId !== null;
  // Which row is showing the inline account-merge form instead of its actions.
  const [mergingKey, setMergingKey] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  function handleSelectAttendee(partyId: number) {
    setActivePartyId(partyId);
    const entry = document.getElementById(attendeeElementId(partyId));
    entry?.scrollIntoView({ behavior: "smooth", block: "start" });
    entry?.focus({ preventScroll: true });
  }

  function handleRsvpSubmitted(rsvp: RsvpResponse) {
    setShowRsvpDialog(false);
    setLastRsvp(rsvp);
    setToast("Zapisano na zajęcia");
    void refetch();
  }

  async function performPledge(neededItemId: number) {
    setPledgingItemId(neededItemId);
    try {
      await createPledge(neededItemId);
      setPledgedItemIds((prev) => [...prev, neededItemId]);
      setToast("Zgłoszono — szczegóły w Twoim panelu");
      await refetch();
    } catch (err) {
      const conflict = err instanceof ApiError && err.status === 409;
      setToast(conflict ? "Ktoś już zadeklarował przyniesienie tej rzeczy" : "Nie udało się zapisać zgłoszenia");
      if (conflict) await refetch();
    } finally {
      setPledgingItemId(null);
    }
  }

  const handlePledge = gateAction(isLoggedIn, () => setShowPledgeGate(true), performPledge);

  // SWAP counter-offers may only use the viewer's own "zamienię"-tagged,
  // currently available items — loaded lazily on the first swap attempt.
  async function loadMyAvailableItems(): Promise<AvailableItem[]> {
    if (myAvailableItems !== null) return myAvailableItems;
    const [profile, products, preferences] = await Promise.all([
      getMyProfile(),
      getProducts(),
      getMyItemListingPreferences(),
    ]);
    if (profile.account_user_id == null) return [];
    const inventories = await getInventories(profile.account_user_id);
    const personal = inventories.find((inv) => inv.inventory_type === "PERSONAL") ?? null;
    if (!personal) return [];
    const swapTaggedItemIds = new Set(preferences.filter((p) => p.mode === "SWAP").map((p) => p.item_id));
    const items = (await getInventoryItems(personal.id)).filter((it) => swapTaggedItemIds.has(it.id));
    const withStatus = await Promise.all(
      items.map(async (it) => ({ it, balance: await getInventoryItemBalance(it.id) })),
    );
    const available = withStatus
      .filter(({ balance }) => balance.status === "AVAILABLE")
      .map(({ it }) => ({
        id: it.id,
        productName: products.find((p) => p.id === it.product_id)?.name ?? `Rzecz #${it.id}`,
      }));
    setMyAvailableItems(available);
    return available;
  }

  function closeSwapPicker() {
    setTakingItemId(null);
    setTakeOfferedItemId(null);
  }

  // A SWAP is always a proposal the owner accepts/rejects: the first click
  // opens `SwapProposeDialog`, its "Zaproponuj zamianę" submits.
  async function performProposeSwap(itemId: number) {
    if (!term) return;
    if (takingItemId !== itemId) {
      const available = await loadMyAvailableItems();
      setTakingItemId(itemId);
      setTakeOfferedItemId(available[0]?.id ?? null);
      return;
    }
    if (takeOfferedItemId === null) {
      setToast("Wybierz rzecz do zamiany");
      return;
    }
    setBusyTakeItemId(itemId);
    try {
      await proposeSwap(itemId, { term_id: term.id, offered_item_id: takeOfferedItemId });
      closeSwapPicker();
      setToast("Zaproponowano zamianę! Szczegóły w Twoim panelu");
      await refetch();
    } catch {
      setToast("Nie udało się zaproponować zamiany");
    } finally {
      setBusyTakeItemId(null);
    }
  }

  async function performTake(itemId: number, reservationType: ReservationType) {
    if (!term) return;
    if (reservationType === "SWAP") {
      await performProposeSwap(itemId);
      return;
    }
    setBusyTakeItemId(itemId);
    try {
      await takeTermItemListing(itemId, { term_id: term.id, reservation_type: reservationType });
      closeSwapPicker();
      setToast("Wzięto! Szczegóły w Twoim panelu");
      await refetch();
    } catch {
      setToast("Nie udało się wziąć tej rzeczy");
    } finally {
      setBusyTakeItemId(null);
    }
  }

  const handleTake = gateAction(isLoggedIn, () => setShowTakeGate(true), performTake);

  function toListingRow(listing: PublicItemListingResponse): ListingRowVM {
    const mergeKey = `listing-${listing.item_id}`;
    const isMerging = mergingKey === mergeKey;
    const offeredTypes = listing.offered_types.filter((t): t is ReservationType =>
      LISTABLE_RESERVATION_TYPES.includes(t as ReservationType),
    );
    return {
      key: listing.item_id,
      title: <strong>{listing.product_name}</strong>,
      actions: isMerging
        ? []
        : offeredTypes.map((t) => ({
            key: t,
            label: TAKE_ACTION_LABELS[t],
            ariaLabel: `${TAKE_ACTION_LABELS[t]}: ${listing.product_name}`,
            disabled: busyTakeItemId === listing.item_id,
            onClick:
              guestProfileId !== null
                ? () => setMergingKey(mergeKey)
                : () => void handleTake(listing.item_id, t),
          })),
      extra:
        isMerging && guestProfileId !== null ? (
          <AccountMergeForm userProfileId={guestProfileId} />
        ) : takingItemId === listing.item_id ? (
          <SwapProposeDialog
            availableItems={myAvailableItems ?? []}
            offeredItemId={takeOfferedItemId}
            onOfferedItemChange={setTakeOfferedItemId}
            listingProductName={listing.product_name}
            busy={busyTakeItemId === listing.item_id}
            onConfirm={() => void performProposeSwap(listing.item_id)}
            onCancel={closeSwapPicker}
          />
        ) : null,
    };
  }

  const neededItems = term?.needed_items ?? [];
  const neededItemRows: NeededItemRowVM[] = neededItems.map((item) => {
    const mergeKey = `needed-${item.id}`;
    const isMerging = mergingKey === mergeKey;
    const pledgedHere = pledgedItemIds.includes(item.id);
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
        !claimed && !isMerging
          ? [
              {
                key: "pledge",
                label: "Ja to przyniosę",
                ariaLabel: `Ja to przyniosę: ${item.product_name}`,
                disabled: pledgingItemId === item.id,
                onClick:
                  guestProfileId !== null
                    ? () => setMergingKey(mergeKey)
                    : () => void handlePledge(item.id),
              },
            ]
          : [],
      extra: isMerging && guestProfileId !== null ? <AccountMergeForm userProfileId={guestProfileId} /> : null,
    };
  });

  const listings = term?.item_listings ?? [];
  const visualizationPeople: VisualizationFamily[] = circle.guardians.map((g) => ({
    familyId: g.party_id,
    name: g.display_name,
    sharesItem: listings.some((l) => l.lister_party_id === g.party_id),
    bringsItem: neededItems.some((n) => n.claimed_by_party_id === g.party_id),
  }));
  const when = term ? formatTermWhen(term.occurs_on) : null;

  return (
    <KragStage
      overlay={
        <>
          {showRsvpGate && !isLoggedIn && (
            <AuthGateSheet
              title="Zapisz się na zajęcia"
              message="Zaloguj się, żeby zapis trafił na Twoje konto — albo zapisz się jako gość."
              onGuest={() => {
                setShowRsvpGate(false);
                setShowRsvpDialog(true);
              }}
              onClose={() => setShowRsvpGate(false)}
            />
          )}
          {showRsvpDialog &&
            term &&
            (isLoggedIn && displayName ? (
              <RsvpDialogLoggedIn
                groupId={groupId}
                termId={term.id}
                displayName={displayName}
                onClose={() => setShowRsvpDialog(false)}
                onSubmitted={handleRsvpSubmitted}
              />
            ) : (
              <RsvpDialog
                groupId={groupId}
                termId={term.id}
                onClose={() => setShowRsvpDialog(false)}
                onSubmitted={handleRsvpSubmitted}
              />
            ))}
          {showPledgeGate && !isLoggedIn && (
            <AuthGateSheet
              title="Potrzebne konto"
              message="Żeby zgłosić, że przyniesiesz coś na zajęcia, musisz mieć konto — dzięki temu organizator wie, kto co przynosi, a rzecz trafia do Twoich zbiorów."
              ariaLabel="Załóż konto, aby przynieść rzecz"
              onClose={() => setShowPledgeGate(false)}
            />
          )}
          {showTakeGate && !isLoggedIn && (
            <AuthGateSheet
              title="Potrzebne konto"
              message="Żeby wziąć, pożyczyć albo zamienić się rzeczą, musisz mieć konto — dzięki temu wiadomo, kto co bierze, a rzecz trafia do Twoich zbiorów."
              ariaLabel="Załóż konto, aby wziąć rzecz"
              onClose={() => setShowTakeGate(false)}
            />
          )}
          {toast && (
            <div className="kg-toast" role="status">
              {toast}
            </div>
          )}
        </>
      }
    >
      <GroupHeader title={circle.name} subtitle={term?.description ?? null} onBack={() => navigate(-1)} />

      <main className="kg-main">
        <GroupVisualization
          layoutMode={circle.layout_mode}
          organizerName={circle.organizer_display_name ?? ""}
          families={visualizationPeople}
          activeFamilyId={activePartyId}
          onSelectFamily={handleSelectAttendee}
          groupId={groupId}
        />

        <TermCard date={when?.date ?? null} time={when?.time} />

        {neededItemRows.length > 0 && (
          <NeededItemsSection
            heading="Potrzebne rzeczy"
            subtitle="Zgłoś się, jeśli możesz coś przynieść na te zajęcia."
            rows={neededItemRows}
          />
        )}

        {term && <AttendeeList attendees={buildAttendees(circle, toListingRow)} activePartyId={activePartyId} />}

        {lastRsvp && !lastRsvp.attached_to_account && !suggestionDismissed && (
          <div className="kg-card">
            <h3 style={{ fontSize: 15 }}>Załóż konto, aby zachować dostęp</h3>
            <AccountMergeForm userProfileId={lastRsvp.user_profile_id} />
            <button className="kg-btn-ghost" style={{ marginTop: 8 }} onClick={() => setSuggestionDismissed(true)}>
              Może później
            </button>
          </div>
        )}
      </main>

      {term && (
        <TermFooter
          isLoggedIn={isLoggedIn}
          isAttending={isAttending}
          onSignUp={() => (isLoggedIn ? setShowRsvpDialog(true) : setShowRsvpGate(true))}
        />
      )}
    </KragStage>
  );
}
