import { createContext, useContext } from "react";
import type { ItemDetailsResponse } from "../../../api/items";
import type { UseItemActionsResult } from "../../../hooks/useItemActions";
import type { UseOpenAndNavigateResult } from "../../../hooks/useOpenAndNavigate";
import type { ItemActionsView } from "./itemActionsViewState";

/** What every block of a loaded item page reads: the details, the actions
 * and the one actions view derived from them (blocks never re-derive it),
 * plus the ITEM chat shared by "Napisz o przedmiocie" and the personal
 * reservation that opens it. */
export interface ItemPageValue {
  item: ItemDetailsResponse;
  actions: UseItemActionsResult;
  view: ItemActionsView;
  isLoggedIn: boolean;
  /** A bare "Dostępna" on a reservable view: a pill beside the listing
   * badges instead of the status card. */
  statusAsPill: boolean;
  chat: UseOpenAndNavigateResult;
}

export const ItemPageContext = createContext<ItemPageValue | null>(null);

export function useItemPage(): ItemPageValue {
  const value = useContext(ItemPageContext);
  if (value === null) throw new Error("Item page blocks render only inside <ItemPage>");
  return value;
}

/** A failed details read, thrown by `ItemPage` to the route's `error.tsx`,
 * which shows its message (other errors get the generic copy). */
export class ItemLoadError extends Error {}
