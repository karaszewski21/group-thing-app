import { useEffect, useState } from "react";
import { useAppNavigate } from "../../routing/navigation";
import type { ListingMode } from "../../api/itemListingPreferences";
import { Field } from "../../components/shared/appComponents";
import { ItemQuickAddForm } from "../../components/shared/ItemQuickAddForm";
import { LocationPicker } from "../../components/shared/LocationPicker";
import { useCreateItem } from "../../hooks/useCreateItem";
import { useMyLocations } from "../../hooks/useMyLocations";
import {
  createEmptyItemQuickAddValue,
  isUntouchedItemQuickAddValue,
  liveLocationId,
  prefillLocationId,
} from "../../utils/itemQuickAdd";
import { EXCHANGE_MODE_LABELS } from "../terms/components/termLabels";
import { PhotoGalleryField } from "../../components/shared/PhotoGalleryField";
import { FIELD_LABEL, MAX_PRODUCT_PHOTOS, photoFileError, type ItemCreatedState } from "./product/itemPageShared";
import { itemPagePath } from "./product/useItemRoutes";
import { useAppData } from "../panel/appDataStore";

const ACTION_CLASS =
  "rounded-[13px] px-4 py-3 text-[13.5px] font-extrabold disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60";
const MISSING_FIELDS_HINT_ID = "item-create-missing-fields";
const TITLE = "Dodaj rzecz";

/** `/add/product`: adds an item to the caller's own inventory — photos,
 * name, condition, category, an optional description and the required
 * place — offered at once (Oddam / Zamienię) or saved as a draft — then
 * replaces itself with the new item's page (handing it what could not be
 * saved). The typed values and photos live in AppDataContext (`itemDraft`,
 * `itemPhotos`), so the place picker's trip to /places/new keeps them; they
 * are cleared only after a successful create. */
export function ItemCreateView() {
  const navigate = useAppNavigate();
  const createItem = useCreateItem();
  const {
    ownSlug,
    items,
    refreshItems,
    itemDraft: value,
    setItemDraft: setValue,
    itemPhotos: photos,
    setItemPhotos: setPhotos,
  } = useAppData();
  const places = useMyLocations();
  const { data: locations, loading: locationsLoading } = places;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

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

  async function submit(mode: ListingMode | null) {
    if (!canSubmit || locationId === null) {
      setAttempted(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { item, failedPhotos, failedDescription } = await createItem(
        { ...value, location_id: locationId },
        photos,
        mode,
      );
      const state: ItemCreatedState | undefined =
        failedPhotos > 0 || failedDescription ? { failedPhotos, failedDescription } : undefined;
      setValue(createEmptyItemQuickAddValue());
      setPhotos([]);
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
        <NewPhotosField files={photos} onChange={setPhotos} disabled={busy} />
        <div className="mt-4">
          <ItemQuickAddForm value={value} onChange={setValue} disabled={busy} />
        </div>
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
            />
          </Field>
        </div>
        {error && (
          <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
            {error}
          </p>
        )}
        {/* Not shown, but still describes the blocked actions to screen readers. */}
        {fieldsMissing && (
          <p id={MISSING_FIELDS_HINT_ID} className="sr-only">
            Podaj nazwę, wybierz kategorię i lokalizację, aby zapisać.
          </p>
        )}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            {...actionState}
            onClick={() => void submit("GIFT")}
            className={`${ACTION_CLASS} bg-mint text-white`}
          >
            {EXCHANGE_MODE_LABELS.GIFT}
          </button>
          <button
            type="button"
            {...actionState}
            onClick={() => void submit("SWAP")}
            className={`${ACTION_CLASS} bg-teal-soft text-ink`}
          >
            {EXCHANGE_MODE_LABELS.SWAP}
          </button>
          <button
            type="button"
            {...actionState}
            onClick={() => void submit(null)}
            className={`${ACTION_CLASS} col-span-2 border-[1.5px] border-line-strong bg-transparent text-ink`}
          >
            Wersja robocza
          </button>
        </div>
      </form>
    </section>
  );
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
