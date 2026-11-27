"use client";

import { useId, useState } from "react";
import { ToastPill } from "../../../components/shared/ToastPill";
import { BTN_GHOST, BTN_LG, BTN_PRIMARY } from "../../../components/shared/uiStyles";
import { useToast } from "../../../components/shared/useToast";
import { useWantsMatchingItem } from "../../../hooks/useWantsMatchingItem";
import { AuthSheet } from "../../auth/AuthSheet";
import { useAccountGate } from "../../auth/useAccountGate";
import { CloseWantSheet } from "../../wanted/CloseWantSheet";
import { ChooseContextSheet } from "../ChooseContextSheet";
import type { ItemActionsView } from "../itemActionsViewState";
import { useItemPage } from "../ItemPageContext";
import { CARD_HINT, FIELD_LABEL, ITEM_ACCOUNT_MESSAGE, ITEM_SECTION } from "../itemPageShared";
import { PartyReservationActions } from "../PartyReservationActions";
import { PersonalPickupSheet } from "../PersonalPickupSheet";
import { POINTS_ACTION, PointsReservationSheet } from "../PointsReservationSheet";
import { SwapProposeDialog } from "../SwapProposeDialog";
import { TakeSuccessSheet } from "../TakeSuccessSheet";
import { useItemTake } from "../useItemTake";

type ChooseView = Extract<ItemActionsView, { kind: "choose" }>;
type AnonymousView = Extract<ItemActionsView, { kind: "anonymous" }>;
type ItemTake = ReturnType<typeof useItemTake>;

const BLOCKABLE = "aria-disabled:cursor-not-allowed aria-disabled:opacity-60";
const PRIMARY_ACTION = `${BTN_PRIMARY} ${BTN_LG} ${BLOCKABLE} mt-2.5 block w-full text-center no-underline`;
const OUTLINE_ACTION = `${BTN_GHOST} ${BTN_LG} ${BLOCKABLE} mt-2.5 block w-full border-primary text-center text-primary-fg no-underline`;
const GHOST_ACTION = `${BTN_GHOST} ${BTN_LG} mt-2.5 block w-full text-center text-ink no-underline`;
const BUY_ACTION = `${POINTS_ACTION} ${BTN_LG} mt-2.5 block w-full text-center no-underline`;
const POINTS_NOTE = "Punkty zostaną zablokowane do odbioru. Spalimy je dopiero, gdy potwierdzisz odbiór.";

function buyLabel(pointsPrice: number | null): string {
  return pointsPrice === null ? "Biorę za punkty" : `Biorę za ${pointsPrice} pkt`;
}

const TITLES: Partial<Record<ItemActionsView["kind"], string>> = { own: "Rezerwacja", reserved: "Rezerwacja" };

/** "Jak chcesz odebrać?": one body per actions view. The reservation flow
 * (`useItemTake`) lives here, not in the "choose" body, because its swap
 * dialog, success sheet and toast must outlive the switch to "reserved"
 * that a successful reservation causes. The personal pickup sheet's
 * "Piszę do" opens the ITEM chat without reserving; a chat failure shows
 * under "Napisz o przedmiocie". The owner
 * sees the section only for a reservation they take part in. After a take
 * the viewer's active wants matching the item are looked up, and the
 * closing prompt opens once the success sheet is gone. The POINTS sheet
 * lives here too and reads the current price from the actions, so „Odśwież”
 * shows a changed price. */
export function ItemPickupActions() {
  const { item, view, isLoggedIn, actions } = useItemPage();
  const { toast, showToast } = useToast();
  const take = useItemTake({ isLoggedIn, refetch: actions.refetch, showToast });
  const takenItemId = isLoggedIn ? take.takenItemId : null;
  const [promptDismissed, setPromptDismissed] = useState(false);
  const [promptFor, setPromptFor] = useState(takenItemId);
  if (promptFor !== takenItemId) {
    setPromptFor(takenItemId);
    setPromptDismissed(false);
  }
  const matchedWants = useWantsMatchingItem(promptDismissed ? null : takenItemId).data;
  const showClosePrompt = !promptDismissed && matchedWants.length > 0 && !take.takeSuccess;
  const pointsPrice = actions.data?.points_price ?? null;

  if (view.kind === "hidden" || view.kind === "unavailable") return null;
  if (view.kind === "own" && !view.partyReservation) return null;

  return (
    <>
      <section
        className={ITEM_SECTION}
        aria-labelledby="item-pickup-heading"
        aria-busy={view.kind === "loading" ? true : undefined}
      >
        <h3 id="item-pickup-heading" className={FIELD_LABEL}>
          {TITLES[view.kind] ?? "Jak chcesz odebrać?"}
        </h3>
        <PickupBody view={view} take={take} />
      </section>
      {take.swap.itemId !== null && (
        <SwapProposeDialog
          availableItems={take.swap.availableItems}
          offeredItemId={take.swap.offeredItemId}
          onOfferedItemChange={take.swap.setOfferedItemId}
          listingProductName={item.name}
          onConfirm={() => take.swap.confirm(item.id)}
          onCancel={take.swap.cancel}
          busy={take.busyItemId === item.id}
        />
      )}
      {take.points.itemId === item.id && take.points.target !== null && pointsPrice !== null && (
        <PointsReservationSheet
          itemName={item.name}
          price={pointsPrice}
          target={take.points.target}
          locationName={actions.data?.location?.locality.name ?? null}
          busy={take.busyItemId === item.id}
          error={take.points.error}
          onConfirm={() => take.points.confirm(item.id, pointsPrice)}
          onRefresh={() => void take.points.refresh()}
          onClose={take.points.cancel}
        />
      )}
      {take.takeSuccess && (
        <TakeSuccessSheet
          itemId={take.takeSuccess.itemId}
          itemName={take.takeSuccess.itemName}
          target={take.takeSuccess.target}
          onClose={take.closeTakeSuccess}
        />
      )}
      {showClosePrompt && <CloseWantSheet wants={matchedWants} onClose={() => setPromptDismissed(true)} />}
      {/* The prompt's buttons sit where the toast floats; the page already shows the reservation. */}
      <ToastPill message={showClosePrompt ? "" : toast} />
    </>
  );
}

function PickupBody({ view, take }: { view: ItemActionsView; take: ItemTake }) {
  const { item, actions } = useItemPage();
  const counterpartyName = item.status.counterparty_label;
  switch (view.kind) {
    case "hidden":
    case "unavailable":
      return null;
    case "loading":
      return <div className="mt-2.5 h-10 animate-pulse rounded-2xl bg-cream" />;
    case "error":
      return (
        <>
          <div role="alert" className="mt-1.5">
            <p className="text-[13px] font-bold text-danger">Nie udało się wczytać akcji</p>
            <p className={CARD_HINT}>{view.message}</p>
          </div>
          <button type="button" onClick={() => void actions.refetch()} className={GHOST_ACTION}>
            Spróbuj ponownie
          </button>
        </>
      );
    case "own":
      return (
        view.partyReservation && (
          <PartyReservationActions
            party={view.partyReservation}
            ownerName="Ty"
            counterpartyName={counterpartyName}
            refetch={actions.refetch}
          />
        )
      );
    case "reserved":
      return view.partyReservation ? (
        <PartyReservationActions
          party={view.partyReservation}
          ownerName={view.owner.display_name}
          counterpartyName={counterpartyName}
          refetch={actions.refetch}
        />
      ) : (
        <TakenActions />
      );
    case "anonymous":
      return view.mode === "POINTS" ? <AnonymousPointsActions view={view} /> : <AnonymousActions />;
    case "choose":
      return view.mode === "POINTS" ? (
        <PointsChooseActions view={view} take={take} />
      ) : (
        <ChooseActions view={view} take={take} />
      );
  }
}

/** Both reserve buttons open the login sheet. */
function AnonymousActions() {
  const gate = useAccountGate(false);
  return (
    <>
      <button type="button" onClick={() => gate.open()} className={PRIMARY_ACTION}>
        Odbiorę osobiście
      </button>
      <button type="button" onClick={() => gate.open()} className={OUTLINE_ACTION}>
        Wybieram termin
      </button>
      {gate.isOpen && <AuthSheet message={ITEM_ACCOUNT_MESSAGE} onClose={gate.close} />}
    </>
  );
}

/** „Biorę za N pkt” for a guest opens the login sheet. */
function AnonymousPointsActions({ view }: { view: AnonymousView }) {
  const gate = useAccountGate(false);
  return (
    <>
      <button type="button" onClick={() => gate.open()} className={BUY_ACTION}>
        {buyLabel(view.pointsPrice)}
      </button>
      <p className={CARD_HINT}>{POINTS_NOTE}</p>
      {gate.isOpen && <AuthSheet message={ITEM_ACCOUNT_MESSAGE} onClose={gate.close} />}
    </>
  );
}

/** Why „Biorę za N pkt” is blocked, or `null` when it is not. */
function pointsBlockedHint(view: ChooseView, reachable: boolean): string | null {
  if (view.pointsPrice === null) return "Cena tej rzeczy jest niedostępna — odśwież stronę.";
  if (reachable) return null;
  if (view.location === null) {
    return `${view.owner.display_name} nie ustawił(a) jeszcze miejsca odbioru — napisz na czacie, żeby się umówić.`;
  }
  return "Nie macie wspólnego terminu ani wydarzenia, a odbiór osobisty nie jest dostępny.";
}

/** „Biorę za N pkt”: a personal pickup goes straight to the points sheet,
 * otherwise the context picker comes first; with both, „Wybieram termin”
 * offers the picker as well. Blocked (`aria-disabled`, with why) when there
 * is neither. */
function PointsChooseActions({ view, take }: { view: ChooseView; take: ItemTake }) {
  const { item } = useItemPage();
  const [picking, setPicking] = useState(false);
  const hintId = useId();
  const busy = take.busyItemId === item.id;
  const personal = view.location !== null && view.personalPickup;
  const withContext = view.eligibleContexts.length > 0;
  const hint = pointsBlockedHint(view, personal || withContext);
  return (
    <>
      <button
        type="button"
        disabled={busy}
        aria-disabled={!busy && hint !== null ? true : undefined}
        aria-describedby={hint !== null ? hintId : undefined}
        onClick={() => {
          if (hint !== null) return;
          if (personal) take.take(item.id, "POINTS", { kind: "PERSONAL" });
          else setPicking(true);
        }}
        className={BUY_ACTION}
      >
        {buyLabel(view.pointsPrice)}
      </button>
      {personal && withContext && hint === null && (
        <button type="button" disabled={busy} onClick={() => setPicking(true)} className={OUTLINE_ACTION}>
          Wybieram termin
        </button>
      )}
      <p id={hint !== null ? hintId : undefined} className={CARD_HINT}>
        {hint ?? POINTS_NOTE}
      </p>
      {picking && (
        <ChooseContextSheet
          ownerName={view.owner.display_name}
          mode={view.mode}
          contexts={view.eligibleContexts}
          onClose={() => setPicking(false)}
          onConfirm={(context) => {
            setPicking(false);
            take.take(item.id, "POINTS", context);
          }}
        />
      )}
    </>
  );
}

/** "Odbiorę osobiście" and "Wybieram termin" with their confirmation
 * sheets. A blocked action stays focusable (`aria-disabled`) so its hint
 * reaches keyboard and screen-reader users; only a running reservation
 * disables it natively. */
function ChooseActions({ view, take }: { view: ChooseView; take: ItemTake }) {
  const { item, chat } = useItemPage();
  const [sheet, setSheet] = useState<"personal" | "context" | null>(null);
  const personalHintId = useId();
  const contextHintId = useId();
  const busy = take.busyItemId === item.id;
  const personalHint =
    view.location === null
      ? `${view.owner.display_name} nie ustawił(a) jeszcze miejsca odbioru — napisz na czacie, żeby się umówić.`
      : !view.personalPickup
        ? "Odbiór osobisty nie jest dostępny dla tej rzeczy."
        : null;
  const contextBlocked = view.eligibleContexts.length === 0;
  return (
    <>
      <button
        type="button"
        disabled={busy}
        aria-disabled={!busy && personalHint !== null ? true : undefined}
        aria-describedby={personalHint !== null ? personalHintId : undefined}
        onClick={() => {
          if (personalHint === null) setSheet("personal");
        }}
        className={PRIMARY_ACTION}
      >
        Odbiorę osobiście
      </button>
      {personalHint !== null && (
        <p id={personalHintId} className={CARD_HINT}>
          {personalHint}
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        aria-disabled={!busy && contextBlocked ? true : undefined}
        aria-describedby={contextBlocked ? contextHintId : undefined}
        onClick={() => {
          if (!contextBlocked) setSheet("context");
        }}
        className={OUTLINE_ACTION}
      >
        Wybieram termin
      </button>
      {contextBlocked && (
        <p id={contextHintId} className={CARD_HINT}>
          Nie macie wspólnego terminu ani wydarzenia, na które jesteś zapisany(-a).
        </p>
      )}
      {sheet === "personal" && view.location && (
        <PersonalPickupSheet
          ownerName={view.owner.display_name}
          itemName={item.name}
          locationName={view.location.locality.name}
          mode={view.mode}
          onClose={() => setSheet(null)}
          onConfirm={() => {
            setSheet(null);
            take.take(item.id, view.mode, { kind: "PERSONAL" });
          }}
          onMessage={() => {
            setSheet(null);
            void chat.open({ kind: "ITEM", id: item.id });
          }}
        />
      )}
      {sheet === "context" && (
        <ChooseContextSheet
          ownerName={view.owner.display_name}
          mode={view.mode}
          contexts={view.eligibleContexts}
          onClose={() => setSheet(null)}
          onConfirm={(context) => {
            setSheet(null);
            take.take(item.id, view.mode, context);
          }}
        />
      )}
    </>
  );
}

/** Both reserve actions for a viewer outside someone else's reservation:
 * focusable but blocked (`aria-disabled`), described by why. */
function TakenActions() {
  const hintId = useId();
  return (
    <>
      <button type="button" aria-disabled="true" aria-describedby={hintId} className={PRIMARY_ACTION}>
        Odbiorę osobiście
      </button>
      <button type="button" aria-disabled="true" aria-describedby={hintId} className={OUTLINE_ACTION}>
        Wybieram termin
      </button>
      <p id={hintId} className={CARD_HINT}>
        Ktoś już zarezerwował tę rzecz. Jeśli rezerwacja zostanie anulowana, znów będzie dostępna.
      </p>
    </>
  );
}
