/**
 * Value shape for `NeededItemQuickAddForm` — a plain needed-item name plus
 * a free-text `description` refinement, sent as-is to `createNeededItem`.
 */
export interface NeededItemQuickAddValue {
  name: string;
  description: string;
}

export function createEmptyNeededItemQuickAddValue(): NeededItemQuickAddValue {
  return { name: "", description: "" };
}
