import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { extractProblemMessage } from "../api/problem";
import { ALREADY_RESOLVED_MESSAGE, cancelTransaction, confirmTransaction, isAlreadyResolved } from "../api/reservations";
import {
  acceptSwapProposal,
  isPersonalSwapAccept,
  PERSONAL_SWAP_ACCEPTED_MESSAGE,
  rejectSwapProposal,
  type AcceptedSwapProposalResponse,
} from "../api/termItemListings";
import dayjs from "../utils/dayjs";
import { EVENT_KEY } from "./useEvent";
import { ITEM_ACTIONS_KEY } from "./useItemActions";
import { ITEM_DETAILS_KEY } from "./useItemDetail";
import { NOTIFICATIONS_KEY } from "./useNotifications";
import { ORGANIZER_PAGE_KEY } from "./useOrganizerPage";
import { OWNER_ITEMS_KEY } from "./useOwnerItems";
import { GROUP_ACCESS_KEY } from "./useTermAccess";

/** Query-key prefixes of every page and list that shows an item's
 * reservation state: a take, a swap proposal and each settlement change them. */
export const RESERVATION_STATE_KEYS = [
  [ITEM_ACTIONS_KEY],
  [ITEM_DETAILS_KEY],
  [OWNER_ITEMS_KEY],
  [ORGANIZER_PAGE_KEY],
  [EVENT_KEY],
  [GROUP_ACCESS_KEY],
  NOTIFICATIONS_KEY,
] as const;

function acceptedCopy(accepted: AcceptedSwapProposalResponse): string {
  if (isPersonalSwapAccept(accepted) || accepted.term_occurs_on === null) return PERSONAL_SWAP_ACCEPTED_MESSAGE;
  const when = dayjs(accepted.term_occurs_on).format("ddd DD.MM [o] HH:mm");
  return accepted.group_name ? `Zamiana przyjęta — odbiór ${when} · ${accepted.group_name}.` : `Zamiana przyjęta — odbiór ${when}.`;
}

export interface UseReservationSettlementResult {
  busy: boolean;
  error: string | null;
  /** The accept's "where and when" line, after a successful accept. */
  success: string | null;
  /** Each action resolves to the error it shows, or `null` on success. */
  confirm: (reservationId: string) => Promise<string | null>;
  cancel: (reservationId: string) => Promise<string | null>;
  accept: (proposalId: string) => Promise<string | null>;
  reject: (proposalId: string) => Promise<string | null>;
}

/** Settling a reservation or a swap proposal: each action awaits invalidation
 * of `RESERVATION_STATE_KEYS`, then `refetch`. A race lost to the other party
 * (409 `already_resolved`) shows its own message and still refreshes; other
 * errors carry the server's message verbatim. Actions never reject; they
 * resolve to that error (or `null`), so a confirm dialog can stay open on it. */
export function useReservationSettlement(refetch: () => Promise<void>): UseReservationSettlementResult {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function refresh() {
    await Promise.all(RESERVATION_STATE_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    await refetch();
  }

  async function run(action: () => Promise<string | null>): Promise<string | null> {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      setSuccess(await action());
      await refresh();
      return null;
    } catch (err) {
      const message = isAlreadyResolved(err) ? ALREADY_RESOLVED_MESSAGE : extractProblemMessage(err);
      setError(message);
      if (isAlreadyResolved(err)) await refresh();
      return message;
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    error,
    success,
    confirm: (reservationId) =>
      run(async () => {
        await confirmTransaction(reservationId);
        return null;
      }),
    cancel: (reservationId) =>
      run(async () => {
        await cancelTransaction(reservationId);
        return null;
      }),
    accept: (proposalId) => run(async () => acceptedCopy(await acceptSwapProposal(proposalId))),
    reject: (proposalId) =>
      run(async () => {
        await rejectSwapProposal(proposalId);
        return null;
      }),
  };
}
