import { useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../api/client";
import { getMyProfile } from "../../api/people";
import { confirmTransaction } from "../../api/reservations";
import { useAuth } from "../../auth/AuthContext";
import { NOTIFICATIONS_KEY, useNotifications } from "../../hooks/useNotifications";
import { ToastPill } from "../shared/ToastPill";
import { useToast } from "../shared/useToast";
import dayjs from "../../utils/dayjs";
import { BTN_GHOST, BTN_LG, BTN_PRIMARY } from "../shared/uiStyles";
import { ModalSheet } from "../shared/ModalSheet";
import { getOpenSheetCount, subscribeOpenSheets } from "../shared/openSheets";
import { emitPendingActionResolved } from "./pendingActionResolved";
import {
  confirmActionTitle,
  derivePendingActions,
  pendingActionKey,
  resolvePendingReservationId,
  type PendingAction,
  type PendingConfirmAction,
  type PendingSwapAction,
} from "./pendingActions";
import { earliestExpiry, getSnoozed, nextLocal0800, snooze } from "./snoozeStore";

const CONFIRM_FAILED = "Nie udało się potwierdzić — spróbuj ponownie";
const PRIMARY_BUTTON = `${BTN_PRIMARY} ${BTN_LG}`;
const GHOST_BUTTON = `${BTN_GHOST} ${BTN_LG}`;

/** App-wide pending-actions prompt (swap proposals, post-term-end confirms),
 * mounted once by `PublicLayout` for logged-in users. Shows one prompt at a
 * time, oldest first. "Później", ✕, scrim and Esc snooze a prompt until the next local 08:00 without marking it read.
 * Renders no prompt while a page-level dialog is open. */
export function PendingActionsHost() {
  const { username } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: notifications, markRead } = useNotifications();
  const openSheetCount = useSyncExternalStore(subscribeOpenSheets, getOpenSheetCount);
  const { toast, showToast } = useToast();

  const [snoozed, setSnoozed] = useState(() => getSnoozed(username));
  // `notificationId`s currently mid-confirm, and ones whose confirm came back
  // "already resolved by the other party" (409 `already_resolved: true`).
  const [pendingActionBusyId, setPendingActionBusyId] = useState<string | null>(null);
  const [alreadyResolvedIds, setAlreadyResolvedIds] = useState<ReadonlySet<string>>(new Set());

  // One timer for the earliest snooze expiry brings that prompt back.
  const nextExpiry = earliestExpiry(snoozed);
  useEffect(() => {
    if (nextExpiry === null) return;
    const t = setTimeout(() => setSnoozed(getSnoozed(username)), Math.max(0, nextExpiry - Date.now()));
    return () => clearTimeout(t);
  }, [nextExpiry, username]);

  const pendingActions = useMemo(
    () => derivePendingActions(notifications).filter((a) => !(pendingActionKey(a) in snoozed)),
    [notifications, snoozed],
  );

  function forgetResolvedState(action: PendingAction) {
    setAlreadyResolvedIds((prev) => {
      if (!prev.has(action.notificationId)) return prev;
      const next = new Set(prev);
      next.delete(action.notificationId);
      return next;
    });
  }

  function snoozeAction(action: PendingAction) {
    forgetResolvedState(action);
    setSnoozed(snooze(username, pendingActionKey(action)));
  }

  /** Marks the underlying notification read (optimistic) — the item then
   * drops out of `pendingActions` on the next render. */
  function dismissPendingAction(action: PendingSwapAction | PendingConfirmAction) {
    forgetResolvedState(action);
    markRead(action.notificationId);
  }

  function openSwapProposalsOnMyItems(action: PendingSwapAction) {
    dismissPendingAction(action);
    navigate("/rzeczy");
  }

  async function confirmPendingAction(action: PendingConfirmAction) {
    const { notificationId, termId, reservationId: notificationReservationId } = action;
    if (notificationReservationId === null && termId === null) {
      showToast(CONFIRM_FAILED);
      return;
    }
    setPendingActionBusyId(notificationId);
    try {
      const reservationId =
        notificationReservationId ??
        (termId !== null ? await resolvePendingReservationId(termId, (await getMyProfile()).party_id) : null);
      if (reservationId === null) {
        // resolvePendingReservationId only ever omits an ACTIVE reservation,
        // so null means the other party already resolved it in the meantime.
        // Treated like the backend's own already-resolved 409.
        setAlreadyResolvedIds((prev) => new Set(prev).add(notificationId));
        return;
      }
      await confirmTransaction(reservationId);
      // Invalidate before marking read, so the refetch cannot bring the
      // prompt back before the server has stored the read.
      await queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
      dismissPendingAction(action);
      showToast("Potwierdzono");
      emitPendingActionResolved();
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        err.body &&
        typeof err.body === "object" &&
        (err.body as { already_resolved?: unknown }).already_resolved === true
      ) {
        setAlreadyResolvedIds((prev) => new Set(prev).add(notificationId));
      } else {
        showToast(CONFIRM_FAILED);
      }
    } finally {
      setPendingActionBusyId(null);
    }
  }

  const action = openSheetCount > 0 ? undefined : pendingActions[0];

  return (
    <>
      {action ? (
        <NotificationActionSheet
          action={action}
          busy={pendingActionBusyId === action.notificationId}
          alreadyResolved={alreadyResolvedIds.has(action.notificationId)}
          onSnooze={() => snoozeAction(action)}
          onDismiss={() => dismissPendingAction(action)}
          onConfirm={(confirmAction) => void confirmPendingAction(confirmAction)}
          onOpenMyItems={(swapAction) => openSwapProposalsOnMyItems(swapAction)}
        />
      ) : null}
      <ToastPill message={toast} />
    </>
  );
}

/** "Przypomnimy jutro o 8:00." — or "dziś" between 00:00 and 08:00, from the
 * same next local 08:00 the snooze uses. */
function SnoozeHint({ id }: { id: string }) {
  const now = new Date();
  const day = dayjs(nextLocal0800(now)).isSame(now, "day") ? "dziś" : "jutro";
  return (
    <p id={id} className="mt-3 text-xs text-ink-soft">
      Przypomnimy {day} o 8:00.
    </p>
  );
}

function NotificationActionSheet({
  action,
  busy,
  alreadyResolved,
  onSnooze,
  onDismiss,
  onConfirm,
  onOpenMyItems,
}: {
  action: PendingSwapAction | PendingConfirmAction;
  busy: boolean;
  alreadyResolved: boolean;
  onSnooze: () => void;
  onDismiss: () => void;
  onConfirm: (action: PendingConfirmAction) => void;
  onOpenMyItems: (action: PendingSwapAction) => void;
}) {
  const hintId = useId();
  const title = action.kind === "SWAP_PROPOSED" ? "Propozycja zamiany" : confirmActionTitle(action);

  return (
    <ModalSheet title={title} onClose={onSnooze} registerAsPageSheet={false}>
      <p className="text-sm text-ink">{action.message}</p>

      {alreadyResolved ? (
        <>
          <p className="mt-3 text-sm font-semibold text-danger" role="alert">
            Transakcja została już rozstrzygnięta przez drugą stronę.
          </p>
          <button type="button" className={`mt-3 ${GHOST_BUTTON}`} onClick={onDismiss}>
            Rozumiem
          </button>
        </>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {action.kind === "TERM_CONFIRMATION_NEEDED" ? (
              <button type="button" className={PRIMARY_BUTTON} disabled={busy} onClick={() => onConfirm(action)}>
                Potwierdź
              </button>
            ) : (
              // Info only, no Accept/Reject here — this host can only ever
              // show the FIRST pending proposal, which would pre-empt the
              // actual choice among competing offers. "Moje rzeczy" lists
              // every pending offer against the item together.
              <button type="button" className={PRIMARY_BUTTON} onClick={() => onOpenMyItems(action)}>
                Zobacz w Moje rzeczy
              </button>
            )}
            <button type="button" className={GHOST_BUTTON} aria-describedby={hintId} onClick={onSnooze}>
              Później
            </button>
          </div>
          <SnoozeHint id={hintId} />
        </>
      )}
    </ModalSheet>
  );
}
