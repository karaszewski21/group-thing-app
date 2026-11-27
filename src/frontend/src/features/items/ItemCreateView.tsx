import { useEffect, useState } from "react";
import { useAppNavigate } from "../../routing/navigation";
import type { ListingMode } from "../../api/itemListingPreferences";
import { Field } from "../../components/shared/appComponents";
import { ItemPointsPreview } from "../../components/shared/ItemPointsPreview";
import { ItemQuickAddForm } from "../../components/shared/ItemQuickAddForm";
import { LocationPicker } from "../../components/shared/LocationPicker";
import { PointsPriceStepper } from "../../components/shared/PointsPriceStepper";
import { useCreateItem, type CreateItemOffer } from "../../hooks/useCreateItem";
import { useItemPointsPreview } from "../../hooks/useItemPointsPreview";
import { useMyLocations } from "../../hooks/useMyLocations";
import { clampPointsPrice, parsePointsPrice } from "../../utils/appHelpers";
import {
  createEmptyItemQuickAddValue,
  isUntouchedItemQuickAddValue,
  liveLocationId,
  prefillLocationId,
} from "../../utils/itemQuickAdd";
import { EXCHANGE_MODE_LABELS } from "../terms/components/termLabels";
import { PhotoGalleryField } from "../../components/shared/PhotoGalleryField";
import { FIELD_LABEL, MAX_PRODUCT_PHOTOS, photoFileError, type ItemCreatedState } from "../product/itemPageShared";
import { itemPagePath } from "../product/useItemRoutes";
import { useAppData } from "../panel/appDataStore";

const ACTION_CLASS =
  "rounded-[13px] px-4 py-3 text-[13.5px] font-extrabold disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60";
const MISSING_FIELDS_HINT_ID = "item-create-missing-fields";
const PHOTO_HINT_ID = "item-create-photo-hint";
const PRICE_ID = "item-create-price";
const TITLE = "Dodaj rzecz";
const MODES: ListingMode[] = ["GIFT", "SWAP", "POINTS"];
const MODE_CLASS =
  "min-h-[52px] rounded-[13px] border border-line-strong bg-paper text-[13px] font-extrabold text-ink disabled:opacity-60";
const MODE_PRESSED_CLASS: Record<ListingMode, string> = {
  GIFT: "aria-pressed:border-mint aria-pressed:bg-mint aria-pressed:text-white",
  SWAP: "aria-pressed:border-mint aria-pressed:bg-mint aria-pressed:text-white",
  // Dark text on the orange, as everywhere it is used (contrast).
  POINTS: "aria-pressed:border-orange aria-pressed:bg-orange aria-pressed:text-ink",
};

/** The typed POINTS price, tied to the category and condition it was typed
 * for: a change of either drops it, so the stepper restarts at the new
 * suggestion. */
interface PriceText {
  key: string;
  text: string;
}

/** `/add/product`: adds an item to the caller's own inventory — photos,
 * name, condition, category, an optional description and the required
 * place — offered at once (one mode group, Oddam / Zamienię / Za punkty,
 * and one primary action) or saved as a draft — then
 * replaces itself with the new item's page (handing it what could not be
 * saved). The typed values and photos live in AppDataContext (`itemDraft`,
 * `itemPhotos`), so the place picker's trip to /places/new keeps them; they
 * are cleared only after a successful create, together with `itemCreated`,
 * the item a failed POINTS offer left behind (the form stays locked on it and
 * a retry only repeats the offer). */
export function ItemCreateView() {
  const navigate = useAppNavigate();
  const {
    ownSlug,
    items,
    refreshItems,
    itemDraft: value,
    setItemDraft: setValue,
    itemPhotos: photos,
    setItemPhotos: setPhotos,
    itemCreated,
    setItemCreated,
  } = useAppData();
  const { createItem } = useCreateItem(itemCreated, setItemCreated);
  const places = useMyLocations();
  const { data: locations, loading: locationsLoading } = places;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [mode, setMode] = useState<ListingMode>("GIFT");
  const [priceText, setPriceText] = useState<PriceText | null>(null);
  const points = useItemPointsPreview(value.category_id || null, value.condition);

  // Suggest a place only on an untouched draft: never over the user's choice.
  const suggestion = locationsLoading ? null : prefillLocationId(items, locations.map((l) => l.id));
  const untouched = value.location_id === null && isUntouchedItemQuickAddValue(value, photos);
  useEffect(() => {
    if (!untouched || suggestion === null) return;
    setValue((prev) => (prev.location_id === null ? { ...prev, location_id: suggestion } : prev));
  }, [untouched, suggestion, setValue]);

  const locationId = liveLocationId(value.location_id, places);
  const fieldsMissing = value.name.trim() === "" || value.category_id === "" || locationId === null;
  const canSubmit = !busy && !fieldsMissing;
  // Missing fields keep the actions focusable (aria-disabled) so the hint reaches
  // keyboard and screen-reader users; only a running save disables them natively.
  const actionState = {
    disabled: busy,
    "aria-disabled": !busy && fieldsMissing ? true : undefined,
    "aria-describedby": fieldsMissing ? MISSING_FIELDS_HINT_ID : undefined,
  };

  // After a failed POINTS PUT the item exists: its fields stay fixed, only the offer is retried.
  const locked = itemCreated !== null;
  const isPoints = mode === "POINTS";
  const priceKey = `${value.category_id}|${value.condition}`;
  const suggestedPrice = points.data;
  // The untyped default is the suggestion fitted into the bounds as the server
  // fits it, so it is valid under any config.
  const defaultPrice =
    suggestedPrice === null ? "" : String(points.bounds ? clampPointsPrice(suggestedPrice, points.bounds) : suggestedPrice);
  const priceRaw = priceText !== null && priceText.key === priceKey ? priceText.text : defaultPrice;
  const price = points.bounds ? parsePointsPrice(priceRaw, points.bounds) : undefined;
  const priceInvalid = isPoints && typeof price !== "number";
  const photoMissing = isPoints && photos.length === 0;
  const primaryBlocked = fieldsMissing || photoMissing || priceInvalid;
  const primaryDescribedBy = [
    fieldsMissing ? MISSING_FIELDS_HINT_ID : null,
    photoMissing ? PHOTO_HINT_ID : null,
    priceInvalid && points.bounds ? `${PRICE_ID}-error` : null,
  ]
    .filter(Boolean)
    .join(" ");
  let primaryLabel = "Wystaw";
  if (isPoints) primaryLabel = typeof price === "number" ? `Wystaw za ${price} pkt` : "Wystaw za punkty";

  function offerFor(listing: boolean): CreateItemOffer | null {
    if (!listing) return { mode: null };
    if (mode !== "POINTS") return { mode };
    return typeof price === "number" && !photoMissing ? { mode, pointsPrice: price } : null;
  }

  async function submit(listing: boolean) {
    const offer = offerFor(listing);
    if (!canSubmit || locationId === null || offer === null) {
      setAttempted(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { item, failedPhotos, failedDescription } = await createItem(
        { ...value, location_id: locationId },
        photos,
        offer,
      );
      const state: ItemCreatedState | undefined =
        failedPhotos > 0 || failedDescription ? { failedPhotos, failedDescription } : undefined;
      setValue(createEmptyItemQuickAddValue());
      setPhotos([]);
      setItemCreated(null);
      // The next create's place suggestion reads the newest item.
      void refreshItems();
      navigate(itemPagePath(ownSlug, item.id), { replace: true, state });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się dodać rzeczy.");
      setBusy(false);
    }
  }

  return (
    <section aria-label={TITLE}>
      {/* No submit button: implicit Enter submission from the name input must do nothing. */}
      <form onSubmit={(e) => e.preventDefault()} className="rounded-[22px] border border-line bg-paper p-5">
        <NewPhotosField files={photos} onChange={setPhotos} disabled={busy || locked} />
        {isPoints && (
          <p className="mt-3 rounded-[14px] bg-accent-soft px-3.5 py-2.5 text-[12.5px] font-semibold text-accent-fg">
            Do oferty za punkty potrzebne jest co najmniej jedno Twoje zdjęcie.
          </p>
        )}
        <div className="mt-4">
          <ItemQuickAddForm value={value} onChange={setValue} disabled={busy || locked} />
        </div>
        {!isPoints && (
          <div className="mt-3">
            <ItemPointsPreview categoryId={value.category_id || null} condition={value.condition} />
          </div>
        )}
        {/* The picker names itself through its aria-label; the Field label is visible copy. */}
        <div className="mt-3">
          <Field label="Lokalizacja" required labelId="item-create-place-label">
            <LocationPicker
              value={locationId}
              onChange={(id) => setValue((prev) => ({ ...prev, location_id: id }))}
              label="Lokalizacja"
              idPrefix="item-create-place"
              required
              invalid={attempted && locationId === null}
              disabled={busy || locked}
            />
          </Field>
        </div>
        <h3 className="mt-5 font-serif text-lg font-bold text-ink">Jak chcesz ją przekazać?</h3>
        <div role="group" aria-label="Tryb oferty" className="mt-2 grid grid-cols-3 gap-2">
          {MODES.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={mode === option}
              disabled={busy}
              onClick={() => setMode(option)}
              className={`${MODE_CLASS} ${MODE_PRESSED_CLASS[option]}`}
            >
              {EXCHANGE_MODE_LABELS[option]}
            </button>
          ))}
        </div>
        {isPoints && (
          <div className="mt-3.5">
            {points.bounds && suggestedPrice !== null ? (
              <PointsPriceStepper
                id={PRICE_ID}
                value={priceRaw}
                onChange={(text) => setPriceText({ key: priceKey, text })}
                bounds={points.bounds}
                suggestion={suggestedPrice}
                disabled={busy}
              />
            ) : (
              <p aria-live="polite" className="text-[12.5px] text-ink-soft">
                {pointsPlaceholder(Boolean(value.category_id), points.error !== null)}
              </p>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
            {error}
          </p>
        )}
        {locked && (
          <p className="mt-3 text-[12.5px] text-ink-soft">
            Rzecz jest już zapisana jako wersja robocza w Moich rzeczach — możesz spróbować wystawić ją ponownie.
          </p>
        )}
        {photoMissing && (
          <p
            id={PHOTO_HINT_ID}
            className="mt-3 rounded-[14px] bg-danger-soft px-3.5 py-2.5 text-[12.5px] font-bold text-danger"
          >
            Dodaj przynajmniej jedno zdjęcie, aby wystawić za punkty.
          </p>
        )}
        {/* Not shown, but still describes the blocked actions to screen readers. */}
        {fieldsMissing && (
          <p id={MISSING_FIELDS_HINT_ID} className="sr-only">
            Podaj nazwę, wybierz kategorię i lokalizację, aby zapisać.
          </p>
        )}
        <div className="mt-4 grid gap-2">
          <button
            type="button"
            disabled={busy}
            aria-disabled={!busy && primaryBlocked ? true : undefined}
            aria-describedby={primaryDescribedBy || undefined}
            onClick={() => void submit(true)}
            className={`${ACTION_CLASS} ${isPoints ? "bg-orange text-ink" : "bg-mint text-white"}`}
          >
            {primaryLabel}
          </button>
          <button
            type="button"
            {...actionState}
            onClick={() => void submit(false)}
            className={`${ACTION_CLASS} border-[1.5px] border-line-strong bg-transparent text-ink`}
          >
            Wersja robocza
          </button>
        </div>
      </form>
    </section>
  );
}

function pointsPlaceholder(hasCategory: boolean, failed: boolean): string {
  if (!hasCategory) return "Wybierz kategorię, aby zobaczyć cenę w punktach.";
  return failed ? "Nie udało się wyliczyć ceny w punktach." : "Liczę cenę w punktach…";
}

interface NewPhotosFieldProps {
  files: File[];
  onChange: (files: File[]) => void;
  disabled: boolean;
}

interface PhotoPreview {
  file: File;
  url: string;
}

/** Local previews of the picked files. The object URLs are created in the effect,
 * so a re-run effect (remount, StrictMode) never reuses a URL its cleanup revoked. */
function usePhotoPreviews(files: File[]): PhotoPreview[] {
  const [previews, setPreviews] = useState<PhotoPreview[]>([]);
  useEffect(() => {
    const next = files.map((file) => ({ file, url: URL.createObjectURL(file) }));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the URLs are an external resource this effect owns
    setPreviews(next);
    return () => next.forEach(({ url }) => URL.revokeObjectURL(url));
  }, [files]);
  return previews;
}

/** Photos kept locally until the item is created, in the order added. */
function NewPhotosField({ files, onChange, disabled }: NewPhotosFieldProps) {
  const [error, setError] = useState<string | null>(null);
  const previews = usePhotoPreviews(files);

  function handleFiles(picked: File[]) {
    const invalid = picked.map(photoFileError).find((message) => message !== null);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    onChange([...files, ...picked].slice(0, MAX_PRODUCT_PHOTOS));
  }

  return (
    <section aria-labelledby="new-item-photos-heading">
      <h3 id="new-item-photos-heading" className={FIELD_LABEL}>
        Zdjęcia ({files.length}/{MAX_PRODUCT_PHOTOS})
      </h3>
      <PhotoGalleryField
        photos={previews.map(({ url }) => ({ id: url, src: url }))}
        max={MAX_PRODUCT_PHOTOS}
        disabled={disabled}
        onFiles={handleFiles}
        onRemove={(url) => {
          const removed = previews.find((preview) => preview.url === url)?.file;
          onChange(files.filter((file) => file !== removed));
        }}
        variant="create"
      />
      {error && (
        <p role="alert" className="mt-1.5 text-[12.5px] font-semibold text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
