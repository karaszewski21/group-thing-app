import type { ItemCondition } from "../api/inventories";
import type { ProductCategory } from "../api/products";

export const CONDITION_LABELS: Record<ItemCondition, string> = {
  NEW: "Nowy",
  LIKE_NEW: "Jak nowy",
  GOOD: "Dobry",
  FAIR: "Znośny",
  POOR: "Słaby",
};

export interface ProductPickerValue {
  selectedProductId: number | "new";
  newProductName: string;
  newProductCategory: ProductCategory;
  condition: ItemCondition;
}

export function createEmptyProductPickerValue(
  defaultProductId: number | "new" = "new",
): ProductPickerValue {
  return {
    selectedProductId: defaultProductId,
    newProductName: "",
    newProductCategory: "OTHER",
    condition: "GOOD",
  };
}
