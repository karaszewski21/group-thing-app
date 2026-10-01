import type { useItemHistory } from "../../hooks/useItemDetail";

export type HistoryState = ReturnType<typeof useItemHistory>;

export const MAX_PRODUCT_PHOTOS = 10;

export const INVALID_PHOTO_URL_MESSAGE = "Podaj poprawny link zaczynający się od http:// lub https://";

/** Navigation state `/product/new` hands the new item's page when some of
 * the photos could not be added. */
export interface ItemCreatedState {
  failedPhotos: number;
}

/** Shown where a product has no category (`category_name` is nullable). */
export const NO_CATEGORY_LABEL = "Bez kategorii";

export const FIELD_LABEL = "text-[11.5px] font-extrabold uppercase tracking-wide text-ink-soft";
export const PRIMARY_BTN =
  "flex-none rounded-[9px] bg-mint px-3 py-1.5 text-[11.5px] font-extrabold text-white disabled:opacity-60";
export const BACK_LINK = "mb-4 inline-flex items-center gap-1.5 text-xs font-bold text-ink-soft";
