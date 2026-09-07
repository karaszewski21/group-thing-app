import type { ItemCondition } from "../api/inventories";
import type { ProductCategory } from "../api/products";

export interface ItemQuickAddValue {
  name: string;
  condition: ItemCondition;
  category: ProductCategory;
}

/**
 * Empty-state factory for `ItemQuickAddForm`'s value shape, mirroring
 * `createEmptyProductPickerValue`'s role — shared by the onboarding item
 * step (Group 7) and PanelPage's "+ Dodaj rzecz" modal (Group 6).
 */
export function createEmptyItemQuickAddValue(): ItemQuickAddValue {
  return {
    name: "",
    condition: "GOOD",
    category: "OTHER",
  };
}
