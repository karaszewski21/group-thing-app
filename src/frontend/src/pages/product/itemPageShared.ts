import type { useItemHistory } from "../../hooks/useItemDetail";

export type HistoryState = ReturnType<typeof useItemHistory>;

export const MAX_PRODUCT_PHOTOS = 10;

/** Photo files the backend accepts (it re-encodes them to WebP). */
export const ACCEPTED_PHOTO_TYPES = "image/jpeg,image/png,image/webp";
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

/** Client-side pre-check so an obviously wrong file fails before upload;
 * the backend validates again and re-encodes. */
export function photoFileError(file: File): string | null {
  if (!ACCEPTED_PHOTO_TYPES.split(",").includes(file.type)) {
    return "Nieobsługiwany plik — dodaj zdjęcie JPG, PNG lub WebP";
  }
  if (file.size > MAX_PHOTO_BYTES) return "Zdjęcie jest za duże (maks. 15 MB)";
  return null;
}

/** Navigation state `/product/new` hands the new item's page when some of
 * the photos could not be added. */
export interface ItemCreatedState {
  failedPhotos: number;
}

/** Shown where a product has no category (`category_name` is nullable). */
export const NO_CATEGORY_LABEL = "Bez kategorii";

export const FIELD_LABEL = "text-[11.5px] font-extrabold uppercase tracking-wide text-ink-soft";
export const PRIMARY_BTN =
  "flex-none rounded-[9px] bg-primary px-3 py-1.5 text-[11.5px] font-extrabold text-on-primary disabled:opacity-60";
export const BACK_LINK = "mb-4 inline-flex items-center gap-1.5 text-xs font-bold text-ink-soft";
