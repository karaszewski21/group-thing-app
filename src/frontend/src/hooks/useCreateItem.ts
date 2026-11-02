import { useCallback } from "react";
import {
  getOrCreatePersonalInventory,
  registerInventoryItem,
  type InventoryItemResponse,
} from "../api/inventories";
import type { ListingMode } from "../api/itemListingPreferences";
import { getMyProfile } from "../api/people";
import { serverMessageOr } from "../api/problem";
import { addProductPhoto, resolveProduct, updateProductDescription } from "../api/products";
import type { ItemQuickAddValue } from "../utils/itemQuickAdd";

const CREATE_FALLBACK = "Nie udało się dodać rzeczy. Spróbuj ponownie.";

export interface CreateItemResult {
  item: InventoryItemResponse;
  /** Photos the backend refused (e.g. a duplicate file or the product's
   * photo limit when the product already had photos). */
  failedPhotos: number;
  /** The optional description was given but could not be saved. */
  failedDescription: boolean;
}

/** Adds an item to the caller's PERSONAL inventory: resolves the product by
 * name within its category, registers the item with `mode` (`GIFT`/`SWAP`
 * offers it at once, `null` saves a draft; the server writes both
 * atomically), then saves the optional description and uploads `photos` to
 * the product in order (the owner check needs the item to exist first).
 * Creation errors are rethrown as Polish messages; a refused description or
 * photo is only reported back, since the item already exists by then. No query caches the
 * caller's item list ("Moje rzeczy" reloads on mount), so nothing is
 * invalidated. */
export function useCreateItem() {
  return useCallback(async (
    value: ItemQuickAddValue,
    photos: File[],
    mode: ListingMode | null,
  ): Promise<CreateItemResult> => {
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
  }, []);
}
