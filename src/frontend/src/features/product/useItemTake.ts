import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getInventoryItemBalance, getMyInventoryItems } from "../../api/inventories";
import { proposeItemSwap, takeItem, type ReservationContextRef } from "../../api/itemReservations";
import { serverMessageOr } from "../../api/problem";
import type { ListingMode } from "../../api/itemListingPreferences";
import { POINTS_KEY } from "../../hooks/usePointsConfig";
import { RESERVATION_STATE_KEYS } from "../../hooks/useReservationSettlement";
import type { AvailableItem } from "./SwapProposeDialog";
import { useAccountGate, type TermActionDeps } from "../auth/useAccountGate";

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

/** Reserving an item: `take(itemId, mode, target)` with a personal, term or
 * event `target`. A SWAP is always a proposal the owner accepts/rejects: the
 * first `take(itemId, "SWAP", target)` opens the swap picker (`swap`), and
 * its `confirm` submits in that target. The viewer's swap items load lazily
 * on the first swap attempt. A term or event take opens `takeSuccess`; a
 * personal one only toasts, as it has no date or place to show. A POINTS
 * take, like a SWAP, first opens its own step (`points`: the reservation
 * sheet with the balance) in the chosen target; its `confirm` holds the
 * price, and a refusal stays in the sheet as the server's message until
 * `refresh` reloads the actions and the points.
 * `takenItemId` is the item of the last successful take (never a swap
 * proposal), cleared when the next take starts. */
export function useItemTake({ isLoggedIn, refetch, showToast }: TermActionDeps) {
  const queryClient = useQueryClient();
  const gate = useAccountGate(isLoggedIn);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [swapPick, setSwapPick] = useState<{ itemId: string; target: TakeTarget } | null>(null);
  const [pointsPick, setPointsPick] = useState<{ itemId: string; target: TakeTarget } | null>(null);
  const [pointsError, setPointsError] = useState<string | null>(null);
  const [offeredItemId, setOfferedItemId] = useState<string | null>(null);
  const [myAvailableItems, setMyAvailableItems] = useState<AvailableItem[] | null>(null);
  const [takeSuccess, setTakeSuccess] = useState<{
    itemId: string;
    itemName: string;
    target: TakeContext;
  } | null>(null);
  const [takenItemId, setTakenItemId] = useState<string | null>(null);

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

  function closePointsSheet() {
    setPointsPick(null);
    setPointsError(null);
  }

  async function refresh(withPoints = false) {
    const keys: readonly (readonly unknown[])[] = withPoints
      ? [...RESERVATION_STATE_KEYS, [POINTS_KEY]]
      : RESERVATION_STATE_KEYS;
    await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    await refetch();
  }

  async function refreshPoints() {
    setPointsError(null);
    await refresh(true);
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
      await refresh();
    } catch (err) {
      showToast(serverMessageOr(err, "Nie udało się zaproponować zamiany"));
    } finally {
      setBusyItemId(null);
    }
  }

  function takeSucceeded(itemId: string, productName: string, target: TakeTarget) {
    if (target.kind === "PERSONAL") showToast("Zarezerwowano!");
    else setTakeSuccess({ itemId, itemName: productName, target });
    setTakenItemId(itemId);
  }

  async function performTake(itemId: string, reservationType: ListingMode, target: TakeTarget) {
    if (reservationType === "SWAP") {
      await openSwapPicker(itemId, target);
      return;
    }
    if (reservationType === "POINTS") {
      setPointsError(null);
      setPointsPick({ itemId, target });
      return;
    }
    setBusyItemId(itemId);
    setTakenItemId(null);
    try {
      const taken = await takeItem(itemId, { context: contextRef(target), reservation_type: reservationType });
      takeSucceeded(taken.item_id, taken.product_name, target);
      closeSwapPicker();
      await refresh();
    } catch (err) {
      showToast(serverMessageOr(err, "Nie udało się wziąć tej rzeczy"));
    } finally {
      setBusyItemId(null);
    }
  }

  async function confirmPoints(itemId: string, pointsPrice: number) {
    if (pointsPick === null || pointsPick.itemId !== itemId) return;
    const { target } = pointsPick;
    setBusyItemId(itemId);
    setTakenItemId(null);
    setPointsError(null);
    try {
      const taken = await takeItem(itemId, {
        context: contextRef(target),
        reservation_type: "POINTS",
        points_price: pointsPrice,
      });
      closePointsSheet();
      takeSucceeded(taken.item_id, taken.product_name, target);
      await refresh(true);
    } catch (err) {
      setPointsError(serverMessageOr(err, "Nie udało się zarezerwować tej rzeczy"));
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
    takenItemId,
    swap: {
      /** The item whose swap picker is open, if any. */
      itemId: swapPick?.itemId ?? null,
      availableItems: myAvailableItems ?? [],
      offeredItemId,
      setOfferedItemId,
      confirm: (itemId: string) => void confirmSwap(itemId),
      cancel: closeSwapPicker,
    },
    points: {
      /** The item whose points sheet is open, if any, and where it is picked up. */
      itemId: pointsPick?.itemId ?? null,
      target: pointsPick?.target ?? null,
      /** The server's refusal of the last attempt, shown in the sheet. */
      error: pointsError,
      confirm: (itemId: string, pointsPrice: number) => void confirmPoints(itemId, pointsPrice),
      /** Reloads the actions and the points, clearing the refusal. */
      refresh: refreshPoints,
      cancel: closePointsSheet,
    },
  };
}
