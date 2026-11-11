export const MAX_PRODUCT_PHOTOS = 3;
export const PRODUCT_DESCRIPTION_MAX = 2000;

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

/** Navigation state `/add/product` hands the new item's page when some of
 * the photos or the description could not be saved. */
export interface ItemCreatedState {
  failedPhotos: number;
  failedDescription: boolean;
}

/** Shown where a product has no category (`category_name` is nullable). */
export const NO_CATEGORY_LABEL = "Bez kategorii";

export const ITEM_ACCOUNT_MESSAGE =
  "Rezerwacja i czat wymagają konta. Zaloguj się albo załóż konto — zostaniesz przy tej rzeczy.";
export const CARD_HINT = "mt-2 text-[13px] text-ink-soft";

/** A titled section of the item page (`<section>` + an `<h3>` in `FIELD_LABEL`). */
export const ITEM_SECTION = "mt-4 rounded-3xl border border-line bg-paper p-5";

export const FIELD_LABEL = "text-[11.5px] font-extrabold uppercase tracking-wide text-ink-soft";
export const BACK_LINK = "mb-4 inline-flex items-center gap-1.5 text-xs font-bold text-ink-soft";
