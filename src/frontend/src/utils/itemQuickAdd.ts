import type { ItemCondition } from "../api/inventories";

export interface ItemQuickAddValue {
  name: string;
  condition: ItemCondition;
  category_id: string;
  description: string;
}

/** Empty value for `ItemQuickAddForm`, used by `ItemCreateView`. The
 * category is required and has no default: the user picks a leaf. */
export function createEmptyItemQuickAddValue(): ItemQuickAddValue {
  return {
    name: "",
    condition: "GOOD",
    category_id: "",
    description: "",
  };
}
