import { useState } from "react";
import { getInventoryItemBalance, getMyInventoryItems } from "../../../api/inventories";
import type { ReservationType } from "../../../api/reservations";
import { proposeSwap, takeTermItemListing } from "../../../api/termItemListings";
import type { AvailableItem } from "../components/SwapProposeDialog";
import { useAccountGate, type TermActionDeps } from "./useAccountGate";

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
    }));
}

/** "Pożycz" / "Zamień" / "Weź na stałe" on an attendee's listed item, for
 * the term `termId`. A SWAP is always a proposal the owner accepts/rejects:
 * the first `take(itemId, "SWAP")` opens the swap picker (`swap`), and its
 * `confirm` submits. The viewer's swap items load lazily on the first swap
 * attempt. */
export function useItemTake({ isLoggedIn, refetch, showToast, termId }: TermActionDeps & { termId: number | null }) {
  const gate = useAccountGate(isLoggedIn);
  const [busyItemId, setBusyItemId] = useState<number | null>(null);
  const [swapItemId, setSwapItemId] = useState<number | null>(null);
  const [offeredItemId, setOfferedItemId] = useState<number | null>(null);
  const [myAvailableItems, setMyAvailableItems] = useState<AvailableItem[] | null>(null);

  async function loadMyAvailableItems(): Promise<AvailableItem[]> {
    if (myAvailableItems !== null) return myAvailableItems;
    const available = await fetchMySwapItems();
    setMyAvailableItems(available);
    return available;
  }

  function closeSwapPicker() {
    setSwapItemId(null);
    setOfferedItemId(null);
  }

  async function performProposeSwap(itemId: number) {
    if (termId === null) return;
    if (swapItemId !== itemId) {
      const available = await loadMyAvailableItems();
      setSwapItemId(itemId);
      setOfferedItemId(available[0]?.id ?? null);
      return;
    }
    if (offeredItemId === null) {
      showToast("Wybierz rzecz do zamiany");
      return;
    }
    setBusyItemId(itemId);
    try {
      await proposeSwap(itemId, { term_id: termId, offered_item_id: offeredItemId });
      closeSwapPicker();
      showToast("Zaproponowano zamianę! Szczegóły w Twoim panelu");
      await refetch();
    } catch {
      showToast("Nie udało się zaproponować zamiany");
    } finally {
      setBusyItemId(null);
    }
  }

  async function performTake(itemId: number, reservationType: ReservationType) {
    if (termId === null) return;
    if (reservationType === "SWAP") {
      await performProposeSwap(itemId);
      return;
    }
    setBusyItemId(itemId);
    try {
      await takeTermItemListing(itemId, { term_id: termId, reservation_type: reservationType });
      closeSwapPicker();
      showToast("Wzięto! Szczegóły w Twoim panelu");
      await refetch();
    } catch {
      showToast("Nie udało się wziąć tej rzeczy");
    } finally {
      setBusyItemId(null);
    }
  }

  return {
    gateOpen: gate.isOpen,
    closeGate: gate.close,
    take: gate.guard(performTake),
    busyItemId,
    swap: {
      /** The listing whose swap picker is open, if any. */
      itemId: swapItemId,
      availableItems: myAvailableItems ?? [],
      offeredItemId,
      setOfferedItemId,
      confirm: (itemId: number) => void performProposeSwap(itemId),
      cancel: closeSwapPicker,
    },
  };
}
