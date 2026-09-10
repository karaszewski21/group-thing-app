import type { ProductCategory } from "../api/products";

/**
 * Value shape for `NeededItemQuickAddForm` — the sibling of
 * `ItemQuickAddValue` minus `condition` (the pledger picks that later),
 * plus a free-text `description` refinement. Callers resolve the `Product`
 * via `resolveProduct({ name, category })` then send `createNeededItem`.
 */
export interface NeededItemQuickAddValue {
  name: string;
  category: ProductCategory;
  description: string;
}

export function createEmptyNeededItemQuickAddValue(): NeededItemQuickAddValue {
  return { name: "", category: "OTHER", description: "" };
}
