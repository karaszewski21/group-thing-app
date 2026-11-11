import type { MyInventoryItemResponse, MyItemsModeFilter } from "../api/inventories";
import { useAppData } from "../features/panel/appDataStore";
import type { UseMyItemsPageResult } from "../hooks/useMyItemsPage";

/** What the fake `useMyItemsPage` was called with, and the result a test
 * forces instead of the default page. */
export const myItemsPageMock: {
  calls: [MyItemsModeFilter | null, string][];
  result: UseMyItemsPageResult | null;
} = { calls: [], result: null };

export function resetMyItemsPageMock() {
  myItemsPageMock.calls = [];
  myItemsPageMock.result = null;
}

export function pageResult(
  items: MyInventoryItemResponse[],
  overrides: Partial<UseMyItemsPageResult> = {},
): UseMyItemsPageResult {
  return {
    items,
    counts: {
      ALL: items.length,
      GIFT: items.filter((it) => it.listing_mode === "GIFT").length,
      SWAP: items.filter((it) => it.listing_mode === "SWAP").length,
    },
    loading: false,
    error: null,
    hasNextPage: false,
    fetchNextPage: async () => {},
    fetchingNextPage: false,
    nextPageError: null,
    ...overrides,
  };
}

// One result per items array, so the view's effects see a stable list.
const defaultResults = new WeakMap<MyInventoryItemResponse[], UseMyItemsPageResult>();

/** Stand-in for `useMyItemsPage` in view tests: the mocked panel items as a
 * single page, unless a test sets `myItemsPageMock.result`. A plain function,
 * so it survives `vi.resetAllMocks()`. */
export function useFakeMyItemsPage(mode: MyItemsModeFilter | null, q: string): UseMyItemsPageResult {
  const items = useAppData().items ?? [];
  myItemsPageMock.calls.push([mode, q]);
  if (myItemsPageMock.result) return myItemsPageMock.result;
  let result = defaultResults.get(items);
  if (!result) {
    result = pageResult(items);
    defaultResults.set(items, result);
  }
  return result;
}
