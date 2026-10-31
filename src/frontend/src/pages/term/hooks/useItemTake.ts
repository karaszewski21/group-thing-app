import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { proposeEventSwap, takeEventItem, type ItemContextResponse } from "../../../api/eventItems";
import { getInventoryItemBalance, getMyInventoryItems } from "../../../api/inventories";
import { serverMessageOr } from "../../../api/problem";
import type { ListingMode } from "../../../api/itemListingPreferences";
import { proposeSwap, takeTermItemListing } from "../../../api/termItemListings";
import { EVENT_KEY } from "../../../hooks/useEvent";
import { ITEM_ACTIONS_KEY } from "../../../hooks/useItemActions";
import { ITEM_DETAILS_KEY } from "../../../hooks/useItemDetail";
import { NOTIFICATIONS_KEY } from "../../../hooks/useNotifications";
import { ORGANIZER_PAGE_KEY } from "../../../hooks/useOrganizerPage";
import { OWNER_ITEMS_KEY } from "../../../hooks/useOwnerItems";
import { itemContextKind, type ItemContext } from "../../product/useItemRoutes";
import type { AvailableItem } from "../modals/SwapProposeDialog";
import { useAccountGate, type TermActionDeps } from "./useAccountGate";

/** The term or event a take happens in: `name` is the circle's or event's
 * name, `starts_at` naive Warsaw wall clock, `path` the context's page. */
export interface TakeContext extends ItemContext {
  name: string;
  starts_at: string;
  path: string;
}

/** The server's `ItemContextResponse` (uppercase `kind`) as a `TakeContext`. */
export function takeContextFrom(context: ItemContextResponse): TakeContext {
  return {
    kind: itemContextKind(context.kind),
    id: context.id,
    name: context.name,
    starts_at: context.starts_at,
    path: context.path,
  };
}

/** Query-key prefixes a take or swap proposal changes: the item page, every
 * list that shows the item as available, and the notifications. */
const TAKE_INVALIDATED_KEYS = [
  [ITEM_ACTIONS_KEY],
  [ITEM_DETAILS_KEY],
  [OWNER_ITEMS_KEY],
  [EVENT_KEY],
  [ORGANIZER_PAGE_KEY],
  NOTIFICATIONS_KEY,
] as const;

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

/** "Zamień" / "Weź na stałe" on a listed item, in the term or event
 * `context`. A SWAP is always a proposal the owner accepts/rejects: the first
 * `take(itemId, "SWAP")` opens the swap picker (`swap`), and its `confirm`
 * submits. The viewer's swap items load lazily on the first swap attempt. */
export function useItemTake({
  isLoggedIn,
  refetch,
  showToast,
  context,
}: TermActionDeps & { context: TakeContext | null }) {
  const queryClient = useQueryClient();
  const gate = useAccountGate(isLoggedIn);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [swapItemId, setSwapItemId] = useState<string | null>(null);
  const [offeredItemId, setOfferedItemId] = useState<string | null>(null);
  const [myAvailableItems, setMyAvailableItems] = useState<AvailableItem[] | null>(null);
  const [takeSuccess, setTakeSuccess] = useState<{
    itemId: string;
    itemName: string;
    context: TakeContext;
  } | null>(null);

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

  async function refresh() {
    await Promise.all(TAKE_INVALIDATED_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    await refetch();
  }

  async function performProposeSwap(itemId: string) {
    if (context === null) return;
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
      if (context.kind === "event") {
        await proposeEventSwap(context.id, itemId, offeredItemId);
      } else {
        await proposeSwap(itemId, { term_id: context.id, offered_item_id: offeredItemId });
      }
      closeSwapPicker();
      showToast("Zaproponowano zamianę! Szczegóły w Twoim panelu");
      await refresh();
    } catch (err) {
      showToast(serverMessageOr(err, "Nie udało się zaproponować zamiany"));
    } finally {
      setBusyItemId(null);
    }
  }

  async function performTake(itemId: string, reservationType: ListingMode) {
    if (context === null) return;
    if (reservationType === "SWAP") {
      await performProposeSwap(itemId);
      return;
    }
    setBusyItemId(itemId);
    try {
      if (context.kind === "event") {
        const taken = await takeEventItem(context.id, itemId, reservationType);
        setTakeSuccess({ itemId: taken.item_id, itemName: taken.product_name, context: takeContextFrom(taken.context) });
      } else {
        const taken = await takeTermItemListing(itemId, { term_id: context.id, reservation_type: reservationType });
        setTakeSuccess({ itemId: taken.item_id, itemName: taken.product_name, context });
      }
      closeSwapPicker();
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
      /** The listing whose swap picker is open, if any. */
      itemId: swapItemId,
      availableItems: myAvailableItems ?? [],
      offeredItemId,
      setOfferedItemId,
      confirm: (itemId: string) => void performProposeSwap(itemId),
      cancel: closeSwapPicker,
    },
  };
}
