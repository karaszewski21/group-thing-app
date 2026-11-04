import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getInventoryItemBalance, getMyInventoryItems } from "../../../api/inventories";
import { proposeItemSwap, takeItem, type ReservationContextRef } from "../../../api/itemReservations";
import { serverMessageOr } from "../../../api/problem";
import type { ListingMode } from "../../../api/itemListingPreferences";
import { RESERVATION_STATE_KEYS } from "../../../hooks/useReservationSettlement";
import type { AvailableItem } from "./SwapProposeDialog";
import { useAccountGate, type TermActionDeps } from "../../auth/useAccountGate";

/** The term or event a take happens in: `name` is the circle's or event's
 * name, `starts_at` naive Warsaw wall clock, `path` the context's page. */
export interface TakeContext {
  kind: "TERM" | "EVENT";
  id: string;
  name: string;
  starts_at: string;
  path: string;
}

/** Where a take happens: a personal pickup at the owner's place, or a term
 * or event. */
export type TakeTarget = { kind: "PERSONAL" } | TakeContext;

function contextRef(target: TakeTarget): ReservationContextRef {
  return target.kind === "PERSONAL" ? { kind: "PERSONAL" } : { kind: target.kind, id: target.id };
}

/** SWAP counter-offers may only use the viewer's own "zamienię"-tagged,
 * currently available items. */
async function fetchMySwapItems(): Promise<AvailableItem[]> {
  const items = (await getMyInventoryItems()).filter((it) => it.listing_mode === "SWAP");
  const withStatus = await Promise.all(
    items.map(async (it) => ({ it, balance: await getInventoryItemBalance(it.id) })),
  );
  return withStatus
    .filter(({ balance }) => balance.status === "AVAILABLE")
    .map(({ it }) => ({
      id: it.id,
      productName: it.product_name,
      condition: it.condition,
    }));
}

interface UseItemTakeOptions extends TermActionDeps {
  /** Runs once a take or a swap proposal succeeded, with its target. */
  onReserved?: (target: TakeTarget) => void;
}

/** Reserving an item: `take(itemId, mode, target)` with a personal, term or
 * event `target`. A SWAP is always a proposal the owner accepts/rejects: the
 * first `take(itemId, "SWAP", target)` opens the swap picker (`swap`), and
 * its `confirm` submits in that target. The viewer's swap items load lazily
 * on the first swap attempt. A term or event take opens `takeSuccess`; a
 * personal one only toasts, as it has no date or place to show. */
export function useItemTake({ isLoggedIn, refetch, showToast, onReserved }: UseItemTakeOptions) {
  const queryClient = useQueryClient();
  const gate = useAccountGate(isLoggedIn);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [swapPick, setSwapPick] = useState<{ itemId: string; target: TakeTarget } | null>(null);
  const [offeredItemId, setOfferedItemId] = useState<string | null>(null);
  const [myAvailableItems, setMyAvailableItems] = useState<AvailableItem[] | null>(null);
  const [takeSuccess, setTakeSuccess] = useState<{
    itemId: string;
    itemName: string;
    target: TakeContext;
  } | null>(null);

  async function loadMyAvailableItems(): Promise<AvailableItem[]> {
    if (myAvailableItems !== null) return myAvailableItems;
    const available = await fetchMySwapItems();
    setMyAvailableItems(available);
    return available;
  }

  function closeSwapPicker() {
    setSwapPick(null);
    setOfferedItemId(null);
  }

  async function refresh() {
    await Promise.all(RESERVATION_STATE_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    await refetch();
  }

  async function openSwapPicker(itemId: string, target: TakeTarget) {
    const available = await loadMyAvailableItems();
    setSwapPick({ itemId, target });
    setOfferedItemId(available[0]?.id ?? null);
  }

  async function confirmSwap(itemId: string) {
    if (swapPick === null || swapPick.itemId !== itemId) return;
    if (offeredItemId === null) {
      showToast("Wybierz rzecz do zamiany");
      return;
    }
    setBusyItemId(itemId);
    try {
      await proposeItemSwap(itemId, { context: contextRef(swapPick.target), offered_item_id: offeredItemId });
      closeSwapPicker();
      showToast("Zaproponowano zamianę! Szczegóły w Twoim panelu");
      onReserved?.(swapPick.target);
      await refresh();
    } catch (err) {
      showToast(serverMessageOr(err, "Nie udało się zaproponować zamiany"));
    } finally {
      setBusyItemId(null);
    }
  }

  async function performTake(itemId: string, reservationType: ListingMode, target: TakeTarget) {
    if (reservationType === "SWAP") {
      await openSwapPicker(itemId, target);
      return;
    }
    setBusyItemId(itemId);
    try {
      const taken = await takeItem(itemId, { context: contextRef(target), reservation_type: reservationType });
      if (target.kind === "PERSONAL") showToast("Zarezerwowano!");
      else setTakeSuccess({ itemId: taken.item_id, itemName: taken.product_name, target });
      closeSwapPicker();
      onReserved?.(target);
      await refresh();
    } catch (err) {
      showToast(serverMessageOr(err, "Nie udało się wziąć tej rzeczy"));
    } finally {
      setBusyItemId(null);
    }
  }

  return {
    gateOpen: gate.isOpen,
    closeGate: gate.close,
    take: gate.guard(performTake),
    busyItemId,
    takeSuccess,
    closeTakeSuccess: () => setTakeSuccess(null),
    swap: {
      /** The item whose swap picker is open, if any. */
      itemId: swapPick?.itemId ?? null,
      availableItems: myAvailableItems ?? [],
      offeredItemId,
      setOfferedItemId,
      confirm: (itemId: string) => void confirmSwap(itemId),
      cancel: closeSwapPicker,
    },
  };
}
