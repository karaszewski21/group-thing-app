/**
 * Value shape for `NeededItemQuickAddForm` — the sibling of
 * `ItemQuickAddValue` minus `condition` (the pledger picks that later),
 * plus a free-text `description` refinement. Callers resolve the `Product`
 * via `resolveProduct({ name, category_id })` then send `createNeededItem`.
 */
export interface NeededItemQuickAddValue {
  name: string;
  category_id: number;
  description: string;
}

/**
 * `categoryId` has no hardcoded default — callers source it from
 * `useCategories()`'s live data at the call site. Omitting it falls back
 * to `0` (no category yet resolved) for callers that don't have category
 * data on hand.
 */
export function createEmptyNeededItemQuickAddValue(categoryId = 0): NeededItemQuickAddValue {
  return { name: "", category_id: categoryId, description: "" };
}
