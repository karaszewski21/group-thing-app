import type { ItemCondition, MyInventoryItemResponse } from "../api/inventories";
import type { ItemDetailsResponse } from "../api/items";

/** Under the item create/edit place picker: what buyers get to see. */
export const ITEM_LOCATION_HELPER = "Kupujący zobaczą tylko miejscowość. Adres widzisz tylko Ty.";

export interface ItemQuickAddValue {
  name: string;
  condition: ItemCondition;
  category_id: string;
  description: string;
  /** One of the owner's saved places; required to save. */
  location_id: string | null;
}

/** Empty value for `ItemQuickAddForm`, used by `ItemCreateView`. The
 * category and the place are required and have no default: the user picks
 * a leaf, and the place comes from `prefillLocationId` or the picker. */
export function createEmptyItemQuickAddValue(): ItemQuickAddValue {
  return {
    name: "",
    condition: "GOOD",
    category_id: "",
    description: "",
    location_id: null,
  };
}

/** Nothing typed or picked yet (the place aside): the only state the
 * create page may prefill the place into. */
export function isUntouchedItemQuickAddValue(value: ItemQuickAddValue, photos: File[]): boolean {
  const empty = createEmptyItemQuickAddValue();
  return (
    photos.length === 0 &&
    value.name === empty.name &&
    value.condition === empty.condition &&
    value.category_id === empty.category_id &&
    value.description === empty.description
  );
}

/** A draft's place as it can be saved: `null` once the caller's loaded places
 * no longer hold it (deleted meanwhile), so the form asks for a place instead
 * of the server answering 404. Kept while the places load or failed to load. */
export function liveLocationId(
  id: string | null,
  places: { data: { id: string }[]; loading: boolean; error: string | null },
): string | null {
  if (id === null || places.loading || places.error !== null) return id;
  return places.data.some((place) => place.id === id) ? id : null;
}

/** The place a new item starts with: the place of the newest item whose
 * place is still among the owner's live places, else the only saved place. */
export function prefillLocationId(items: MyInventoryItemResponse[], liveLocationIds: string[]): string | null {
  const live = new Set(liveLocationIds);
  const newest = items
    .filter((item) => item.location_id !== null && live.has(item.location_id))
    .reduce<MyInventoryItemResponse | null>(
      (best, item) => (best === null || item.created_at > best.created_at ? item : best),
      null,
    );
  if (newest) return newest.location_id;
  return liveLocationIds.length === 1 ? liveLocationIds[0] : null;
}

/** The `/items/:id/edit` form, kept in AppDataContext (`itemEdit`) so a trip
 * to /places/new from its place picker keeps the typed values. */
export interface ItemEditDraft {
  name: string;
  categoryId: string;
  condition: ItemCondition;
  description: string;
  locationId: string | null;
}

/** The edit form seeded from the item's details; a `null` place (none, or a
 * deleted one) starts the required picker empty. */
export function itemEditDraftFrom(item: ItemDetailsResponse): ItemEditDraft {
  return {
    name: item.name,
    categoryId: item.category_id,
    condition: item.condition,
    description: item.description ?? "",
    locationId: item.location_id,
  };
}
