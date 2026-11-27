import { useCallback } from "react";
import {
  getOrCreatePersonalInventory,
  registerInventoryItem,
  type InventoryItemResponse,
} from "../api/inventories";
import { ApiError } from "../api/client";
import { setItemListingPreference, type ListingMode } from "../api/itemListingPreferences";
import { getMyProfile } from "../api/people";
import { serverMessageOr } from "../api/problem";
import { addProductPhoto, resolveProduct, updateProductDescription } from "../api/products";
import type { ItemQuickAddValue } from "../utils/itemQuickAdd";

const CREATE_FALLBACK = "Nie udało się dodać rzeczy. Spróbuj ponownie.";
const LIST_FALLBACK = "Nie udało się wystawić rzeczy. Spróbuj ponownie.";
const ITEM_GONE = "Ta rzecz została w międzyczasie usunięta. Dodaj ją ponownie.";

export interface CreateItemResult {
  item: InventoryItemResponse;
  /** Photos the backend refused (e.g. a duplicate file or the product's
   * photo limit when the product already had photos). */
  failedPhotos: number;
  /** The optional description was given but could not be saved. */
  failedDescription: boolean;
}

/** The offer to make on create: a mode, and for POINTS the owner's price. */
export type CreateItemOffer =
  | { mode: "GIFT" | "SWAP" }
  | { mode: "POINTS"; pointsPrice: number }
  | { mode: null };

/** Adds an item to the caller's PERSONAL inventory: resolves the product by
 * name within its category, registers the item at the chosen place, then
 * saves the optional description and uploads `photos` to the product in
 * order (the owner check needs the item to exist first). GIFT/SWAP are
 * written with the item atomically; POINTS needs the uploaded photos, so the
 * item is registered as a draft and offered by a PUT afterwards. When that
 * PUT fails, the created item is handed to `onCreated` (a draft in My
 * Items); while the host passes it back as `created`, the next call only
 * repeats the PUT for it — no second item, no re-upload. The host keeps it
 * beside its draft, so it survives a remount, and clears it with the draft;
 * a 404 on that PUT (the item was deleted elsewhere) hands back `null`, so
 * the form unlocks and the next call creates the item anew. Errors are rethrown as Polish messages; a refused description
 * or photo is only reported back, since the item already exists by then. No
 * query caches the caller's item list ("Moje rzeczy" reloads on mount), so
 * nothing is invalidated. */
export function useCreateItem(
  created: CreateItemResult | null,
  onCreated: (result: CreateItemResult | null) => void,
) {
  const createItem = useCallback(async (
    value: ItemQuickAddValue & { location_id: string },
    photos: File[],
    offer: CreateItemOffer,
  ): Promise<CreateItemResult> => {
    let result = created;
    if (result === null) {
      result = await registerWithPhotos(value, photos, offer.mode === "POINTS" ? null : offer.mode);
      if (offer.mode !== "POINTS") return result;
      onCreated(result);
    }
    if (offer.mode !== null) {
      try {
        if (offer.mode === "POINTS") {
          await setItemListingPreference(result.item.id, "POINTS", undefined, offer.pointsPrice);
        } else {
          await setItemListingPreference(result.item.id, offer.mode);
        }
      } catch (err) {
        if (offer.mode === "POINTS" && err instanceof ApiError && err.status === 404) {
          onCreated(null);
          throw new Error(ITEM_GONE);
        }
        throw new Error(serverMessageOr(err, LIST_FALLBACK));
      }
    }
    return result;
  }, [created, onCreated]);

  return { createItem };
}

async function registerWithPhotos(
  value: ItemQuickAddValue & { location_id: string },
  photos: File[],
  mode: ListingMode | null,
): Promise<CreateItemResult> {
  let productId: string;
  let item: InventoryItemResponse;
  try {
    const profile = await getMyProfile();
    if (profile.account_user_id == null) throw new Error(CREATE_FALLBACK);
    const inventory = await getOrCreatePersonalInventory(profile.account_user_id);
    const product = await resolveProduct({ name: value.name.trim(), category_id: value.category_id });
    // Ids are UUID strings at runtime; ProductResponse still declares `number`.
    productId = String(product.id);
    item = await registerInventoryItem({
      inventory_id: inventory.id,
      product_id: product.id,
      condition: value.condition,
      location_id: value.location_id,
      listing_mode: mode,
    });
  } catch (err) {
    throw new Error(serverMessageOr(err, CREATE_FALLBACK));
  }

  let failedDescription = false;
  const description = value.description.trim();
  if (description) {
    try {
      await updateProductDescription(productId, description);
    } catch {
      failedDescription = true;
    }
  }

  let failedPhotos = 0;
  for (const photo of photos) {
    try {
      await addProductPhoto(productId, photo);
    } catch {
      failedPhotos += 1;
    }
  }
  return { item, failedPhotos, failedDescription };
}
