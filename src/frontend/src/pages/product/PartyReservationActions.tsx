import { useState } from "react";
import type { ItemPartyReservationResponse } from "../../api/itemActions";
import { ConfirmDeleteDialog } from "../../components/shared/ConfirmDeleteDialog";
import { BTN_GHOST, BTN_LG, BTN_PRIMARY } from "../../components/shared/uiStyles";
import { useReservationSettlement } from "../../hooks/useReservationSettlement";

const PRIMARY_ACTION = `${BTN_PRIMARY} ${BTN_LG} mt-2.5 block w-full text-center`;
const GHOST_ACTION = `${BTN_GHOST} ${BTN_LG} mt-2.5 block w-full text-center text-ink`;
const HINT = "mt-2 text-[13px] text-ink-soft";

/** Ends a sentence with a full stop unless the name already brings one ("Bartek K."). */
function sentenceEnd(text: string): string {
  return text.endsWith(".") ? text : `${text}.`;
}

/** The hint for a party who has no button to press yet. */
function waitingHint(party: ItemPartyReservationResponse, ownerName: string, receiverName: string): string | null {
  if (party.proposal_id !== null && party.role === "RECEIVER" && !party.can_accept) {
    return `Czekasz na odpowiedź ${sentenceEnd(ownerName)} Możesz napisać na czacie.`;
  }
  if (party.reservation_id === null || party.proposal_id !== null) return null;
  if (!party.can_confirm && !party.can_cancel) return party.personal_pickup ? null : "Potwierdzicie po terminie.";
  if (party.reservation_type === "GIFT" && party.role === "GIVER" && !party.can_confirm) {
    return `Przekazanie potwierdza ${receiverName}, gdy odbierze rzecz.`;
  }
  return null;
}

interface PartyReservationActionsProps {
  party: ItemPartyReservationResponse;
  ownerName: string;
  /** The other party's label from the item status, when the server sends one. */
  counterpartyName: string | null;
  refetch: () => Promise<void>;
}

/** Settling the caller's reservation or pending swap proposal on the item
 * page: confirm/cancel the hand-over, accept/reject a proposal. The buttons
 * follow the server's `can_*` flags; cancelling and rejecting ask first, and
 * that dialog closes only on success — a failure stays inline in it (the card
 * shows the same error once the dialog is closed). */
export function PartyReservationActions({ party, ownerName, counterpartyName, refetch }: PartyReservationActionsProps) {
  const settlement = useReservationSettlement(refetch);
  const [confirming, setConfirming] = useState<"cancel" | "reject" | null>(null);
  const { busy, error, success } = settlement;

  const { reservation_id: reservationId, proposal_id: proposalId } = party;
  const hint = waitingHint(party, ownerName, counterpartyName ?? "odbiorca");

  async function settleInDialog(action: () => Promise<string | null>) {
    const failure = await action();
    if (failure !== null) throw new Error(failure);
    setConfirming(null);
  }

  return (
    <div>
      {party.can_confirm && reservationId !== null && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void settlement.confirm(reservationId)}
          className={PRIMARY_ACTION}
        >
          Potwierdzam przekazanie
        </button>
      )}
      {party.can_accept && proposalId !== null && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void settlement.accept(proposalId)}
          className={PRIMARY_ACTION}
        >
          Przyjmij zamianę
        </button>
      )}
      {party.can_reject && proposalId !== null && (
        <button type="button" disabled={busy} onClick={() => setConfirming("reject")} className={GHOST_ACTION}>
          Odrzuć
        </button>
      )}
      {party.can_cancel && reservationId !== null && (
        <button type="button" disabled={busy} onClick={() => setConfirming("cancel")} className={GHOST_ACTION}>
          Anuluj rezerwację
        </button>
      )}
      {hint && <p className={HINT}>{hint}</p>}
      {success && (
        <p role="status" className="mt-2 text-[13px] font-bold text-primary-fg">
          {success}
        </p>
      )}
      {error && confirming === null && (
        <p role="alert" className="mt-2 text-xs font-semibold text-danger">
          {error}
        </p>
      )}
      {confirming === "cancel" && reservationId !== null && (
        <ConfirmDeleteDialog
          title="Anulować rezerwację?"
          body="Rzecz znów będzie dostępna dla innych."
          confirmLabel="Tak, anuluj"
          busyLabel="Anulowanie…"
          fallbackError="Nie udało się anulować rezerwacji"
          onConfirm={() => settleInDialog(() => settlement.cancel(reservationId))}
          onClose={() => setConfirming(null)}
        />
      )}
      {confirming === "reject" && proposalId !== null && (
        <ConfirmDeleteDialog
          title="Odrzucić propozycję zamiany?"
          body="Osoba proponująca zamianę dostanie powiadomienie."
          confirmLabel="Tak, odrzuć"
          busyLabel="Odrzucanie…"
          fallbackError="Nie udało się odrzucić propozycji"
          onConfirm={() => settleInDialog(() => settlement.reject(proposalId))}
          onClose={() => setConfirming(null)}
        />
      )}
    </div>
  );
}
