import type { ItemCondition } from "../api/inventories";

export interface ItemQuickAddValue {
  name: string;
  condition: ItemCondition;
  category_id: string;
}

/**
 * Empty value for `ItemQuickAddForm`, used by `ItemCreatePage`. Categories
 * are backend data, so there is no hardcoded default: the caller passes one
 * from `useCategories()` or leaves it empty until they load.
 */
export function createEmptyItemQuickAddValue(categoryId = ''): ItemQuickAddValue {
  return {
    name: "",
    condition: "GOOD",
    category_id: categoryId,
  };
}
