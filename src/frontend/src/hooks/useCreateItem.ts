import { useCallback } from "react";
import {
  getOrCreatePersonalInventory,
  registerInventoryItem,
  type InventoryItemResponse,
} from "../api/inventories";
import { getMyProfile } from "../api/people";
import { serverMessageOr } from "../api/problem";
import { addProductPhoto, resolveProduct } from "../api/products";
import type { ItemQuickAddValue } from "../utils/itemQuickAdd";

const CREATE_FALLBACK = "Nie udało się dodać rzeczy. Spróbuj ponownie.";

export interface CreateItemResult {
  item: InventoryItemResponse;
  /** Photos the backend refused (e.g. a duplicate file or the product's
   * photo limit when the product already had photos). */
  failedPhotos: number;
}

/** Adds an item to the caller's PERSONAL inventory: resolves the product by
 * name within its category, registers the item, then uploads `photos` to the
 * product in order (the owner check needs the item to exist first). Creation
 * errors are rethrown as Polish messages; a refused photo only counts towards
 * `failedPhotos`, since the item already exists by then. No query caches the
 * caller's item list ("Moje rzeczy" reloads on mount), so nothing is
 * invalidated. */
export function useCreateItem() {
  return useCallback(async (value: ItemQuickAddValue, photos: File[]): Promise<CreateItemResult> => {
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
      });
    } catch (err) {
      throw new Error(serverMessageOr(err, CREATE_FALLBACK));
    }

    let failedPhotos = 0;
    for (const photo of photos) {
      try {
        await addProductPhoto(productId, photo);
      } catch {
        failedPhotos += 1;
      }
    }
    return { item, failedPhotos };
  }, []);
}
