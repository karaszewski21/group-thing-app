import type { ItemCondition } from "../api/inventories";

export interface ItemQuickAddValue {
  name: string;
  condition: ItemCondition;
  category_id: number;
}

/**
 * Empty-state factory for `ItemQuickAddForm`'s value shape, mirroring
 * `createEmptyProductPickerValue`'s role — shared by the onboarding item
 * step (Group 7) and PanelPage's "+ Dodaj rzecz" modal (Group 6).
 *
 * `categoryId` has no hardcoded default (there's no more "OTHER" literal
 * once category is a backend-defined FK) — callers source it from
 * `useCategories()`'s live data at the call site. Omitting it falls back
 * to `0` (no category yet resolved) for callers that don't have category
 * data on hand.
 */
export function createEmptyItemQuickAddValue(categoryId = 0): ItemQuickAddValue {
  return {
    name: "",
    condition: "GOOD",
    category_id: categoryId,
  };
}
