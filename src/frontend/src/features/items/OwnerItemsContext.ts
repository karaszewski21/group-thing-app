import { createContext, useContext } from "react";
import type { OwnerItemsPageResponse } from "../../api/ownerItems";
import type { OwnerRef, UseOwnerItemsResult } from "../../hooks/useOwnerItems";
import type { ExchangeFilter } from "./blocks/ExchangeModeTabs";

export type OwnerItemsFilter = Exclude<ExchangeFilter, "RESERVED">;

/** What every block of a loaded owner items page reads: the owner, their
 * unfiltered counts and the paged items of the selected mode. */
export interface OwnerItemsPageValue {
  ownerRef: OwnerRef;
  owner: OwnerItemsPageResponse["owner"];
  counts: OwnerItemsPageResponse["counts"];
  items: UseOwnerItemsResult;
  filter: OwnerItemsFilter;
  setFilter: (filter: OwnerItemsFilter) => void;
}

export const OwnerItemsPageContext = createContext<OwnerItemsPageValue | null>(null);

export function useOwnerItemsPage(): OwnerItemsPageValue {
  const value = useContext(OwnerItemsPageContext);
  if (value === null) throw new Error("Owner items blocks render only inside <OwnerItemsPage>");
  return value;
}

/** A failed owner or Organization read, thrown by `OwnerItemsPage` to the
 * route's `error.tsx`. */
export class OwnerItemsLoadError extends Error {}
