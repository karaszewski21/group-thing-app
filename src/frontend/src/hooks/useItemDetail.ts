import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { updateInventoryItem, type ItemCondition } from "../api/inventories";
import {
  getItemDetails,
  getItemHistory,
  type ItemDetailsResponse,
  type ItemHistoryEntryResponse,
} from "../api/items";
import { extractProblemMessage, serverMessageOr } from "../api/problem";
import {
  addProductPhoto,
  deleteProductPhoto,
  reorderProductPhotos,
  resolveProduct,
  updateProductDescription,
} from "../api/products";
import { hasStatus } from "./useTermAttendees";

const ITEM_DETAILS_KEY = "itemDetails";
const ITEM_HISTORY_KEY = "itemHistory";

const NO_HISTORY: ItemHistoryEntryResponse[] = [];

const SAVE_FALLBACK = "Nie udało się zapisać zmian. Spróbuj ponownie.";
const PHOTO_FALLBACK = "Nie udało się zaktualizować zdjęć. Spróbuj ponownie.";
const PRODUCT_STALE =
  "Dane produktu są nieaktualne — odśwież je, zanim zmienisz zdjęcia lub opis.";

interface UseItemDetailResult {
  item: ItemDetailsResponse | null;
  notFound: boolean;
  error: string | null;
  loading: boolean;
  /** Any fetch in flight, background refetches included. */
  fetching: boolean;
  refetch: () => Promise<void>;
}

/** The item page's details. A 400 (malformed id in the URL; the backend
 * reports validation errors as 400) reads as "not found", like a 404. */
export function useItemDetail(itemId: string): UseItemDetailResult {
  const query = useQuery({
    queryKey: [ITEM_DETAILS_KEY, itemId],
    queryFn: () => getItemDetails(itemId),
  });
  const { refetch: refetchQuery } = query;
  const refetch = useCallback(async () => {
    await refetchQuery();
  }, [refetchQuery]);

  const notFound = hasStatus(query.error, 404) || hasStatus(query.error, 400);
  return {
    item: query.data ?? null,
    notFound,
    error: query.error && !notFound ? extractProblemMessage(query.error) : null,
    loading: query.isPending,
    fetching: query.isFetching,
    refetch,
  };
}

interface UseItemHistoryResult {
  data: ItemHistoryEntryResponse[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** Separate from the details query so a history failure leaves the rest
 * of the page usable. */
export function useItemHistory(itemId: string): UseItemHistoryResult {
  const query = useQuery({
    queryKey: [ITEM_HISTORY_KEY, itemId],
    queryFn: () => getItemHistory(itemId),
  });
  const { refetch: refetchQuery } = query;
  const refetch = useCallback(async () => {
    await refetchQuery();
  }, [refetchQuery]);

  return {
    data: query.data ?? NO_HISTORY,
    loading: query.isPending,
    error: query.error ? extractProblemMessage(query.error) : null,
    refetch,
  };
}

/** What product-scoped edits need from the details query. */
export interface ProductDetailsState {
  productId: string;
  fetching: boolean;
  failed: boolean;
}

/** Owner edits. Photos and the description belong to the item's product,
 * so those calls go to `details.productId`. After a name/category re-point
 * the cached details name the old product until the refetch lands, so
 * product edits stay blocked until the details carry the product just set;
 * a failed refetch keeps them blocked (the calls reject without a request,
 * `productEditable` is false). Every call re-reads the details afterwards,
 * on failure too, so a 409 (stale photo list, photo limit) leaves the page
 * showing the server state; errors are rethrown as Polish messages.
 * `photoBusy` covers a photo call through its follow-up refetch. */
export function useItemEditing(itemId: string, details: ProductDetailsState) {
  const { productId, fetching, failed } = details;
  const queryClient = useQueryClient();
  const [photoBusy, setPhotoBusy] = useState(false);
  const [repointedTo, setRepointedTo] = useState<string | null>(null);

  const productStale = failed || (repointedTo !== null && repointedTo !== productId);

  const mutate = useCallback(
    async (call: () => Promise<unknown>, fallback: string) => {
      const invalidate = () => queryClient.invalidateQueries({ queryKey: [ITEM_DETAILS_KEY] });
      try {
        await call();
      } catch (err) {
        await invalidate();
        throw new Error(serverMessageOr(err, fallback));
      }
      await invalidate();
    },
    [queryClient],
  );

  const mutateProduct = useCallback(
    async (call: (currentProductId: string) => Promise<unknown>, fallback: string) => {
      if (productStale) throw new Error(PRODUCT_STALE);
      await mutate(() => call(productId), fallback);
    },
    [mutate, productStale, productId],
  );

  const mutatePhotos = useCallback(
    async (call: (currentProductId: string) => Promise<unknown>) => {
      setPhotoBusy(true);
      try {
        await mutateProduct(call, PHOTO_FALLBACK);
      } finally {
        setPhotoBusy(false);
      }
    },
    [mutateProduct],
  );

  const saveNameCategory = useCallback(
    (name: string, categoryId: string) =>
      mutate(async () => {
        const product = await resolveProduct({ name, category_id: categoryId });
        await updateInventoryItem(itemId, { product_id: product.id });
        setRepointedTo(String(product.id));
      }, SAVE_FALLBACK),
    [mutate, itemId],
  );

  const saveCondition = useCallback(
    (condition: ItemCondition) =>
      mutate(() => updateInventoryItem(itemId, { condition }), SAVE_FALLBACK),
    [mutate, itemId],
  );

  const saveDescription = useCallback(
    (text: string) =>
      mutateProduct((id) => updateProductDescription(id, text.trim() || null), SAVE_FALLBACK),
    [mutateProduct],
  );

  const addPhoto = useCallback(
    (file: File) => mutatePhotos((id) => addProductPhoto(id, file)),
    [mutatePhotos],
  );

  const removePhoto = useCallback(
    (photoId: string) => mutatePhotos((id) => deleteProductPhoto(id, photoId)),
    [mutatePhotos],
  );

  const movePhoto = useCallback(
    async (photoId: string, direction: "up" | "down") => {
      const details = queryClient.getQueryData<ItemDetailsResponse>([ITEM_DETAILS_KEY, itemId]);
      const ids = (details?.photos ?? []).map((p) => p.id);
      const from = ids.indexOf(photoId);
      const to = direction === "up" ? from - 1 : from + 1;
      if (from === -1 || to < 0 || to >= ids.length) return;
      [ids[from], ids[to]] = [ids[to], ids[from]];
      await mutatePhotos((id) => reorderProductPhotos(id, ids));
    },
    [queryClient, itemId, mutatePhotos],
  );

  return {
    saveNameCategory,
    saveCondition,
    saveDescription,
    addPhoto,
    removePhoto,
    movePhoto,
    photoBusy,
    /** Photo/description editors may open: details are settled and current. */
    productEditable: !productStale && !fetching,
  };
}
