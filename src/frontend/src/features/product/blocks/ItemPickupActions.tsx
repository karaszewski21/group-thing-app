"use client";

import { useId, useState } from "react";
import { ToastPill } from "../../../components/shared/ToastPill";
import { BTN_GHOST, BTN_LG, BTN_PRIMARY } from "../../../components/shared/uiStyles";
import { useToast } from "../../../components/shared/useToast";
import { AuthSheet } from "../../auth/AuthSheet";
import { useAccountGate } from "../../auth/useAccountGate";
import { ChooseContextSheet } from "../ChooseContextSheet";
import type { ItemActionsView } from "../itemActionsViewState";
import { useItemPage } from "../ItemPageContext";
import { CARD_HINT, FIELD_LABEL, ITEM_ACCOUNT_MESSAGE, ITEM_SECTION } from "../itemPageShared";
import { PartyReservationActions } from "../PartyReservationActions";
import { PersonalPickupSheet } from "../PersonalPickupSheet";
import { SwapProposeDialog } from "../SwapProposeDialog";
import { TakeSuccessSheet } from "../TakeSuccessSheet";
import { useItemTake } from "../useItemTake";

type ChooseView = Extract<ItemActionsView, { kind: "choose" }>;
type ItemTake = ReturnType<typeof useItemTake>;

const BLOCKABLE = "aria-disabled:cursor-not-allowed aria-disabled:opacity-60";
const PRIMARY_ACTION = `${BTN_PRIMARY} ${BTN_LG} ${BLOCKABLE} mt-2.5 block w-full text-center no-underline`;
const OUTLINE_ACTION = `${BTN_GHOST} ${BTN_LG} ${BLOCKABLE} mt-2.5 block w-full border-primary text-center text-primary-fg no-underline`;
const GHOST_ACTION = `${BTN_GHOST} ${BTN_LG} mt-2.5 block w-full text-center text-ink no-underline`;

const TITLES: Partial<Record<ItemActionsView["kind"], string>> = { own: "Rezerwacja", reserved: "Rezerwacja" };

/** "Jak chcesz odebrać?": one body per actions view. The reservation flow
 * (`useItemTake`) lives here, not in the "choose" body, because its swap
 * dialog, success sheet and toast must outlive the switch to "reserved"
 * that a successful reservation causes. The personal pickup sheet's
 * "Piszę do" opens the ITEM chat without reserving; a chat failure shows
 * under "Napisz o przedmiocie". The owner
 * sees the section only for a reservation they take part in. */
export function ItemPickupActions() {
  const { item, view, isLoggedIn, actions } = useItemPage();
  const { toast, showToast } = useToast();
  const take = useItemTake({ isLoggedIn, refetch: actions.refetch, showToast });
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
      {take.takeSuccess && (
        <TakeSuccessSheet
          itemId={take.takeSuccess.itemId}
          itemName={take.takeSuccess.itemName}
          target={take.takeSuccess.target}
          onClose={take.closeTakeSuccess}
        />
      )}
      <ToastPill message={toast} />
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
      return <AnonymousActions />;
    case "choose":
      return <ChooseActions view={view} take={take} />;
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
