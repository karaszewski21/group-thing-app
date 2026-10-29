import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ListingMode } from "../../api/itemListingPreferences";
import { ItemQuickAddForm } from "../../components/shared/ItemQuickAddForm";
import { SubPageHeader } from "../../components/shared/appComponents";
import { useCreateItem } from "../../hooks/useCreateItem";
import { createEmptyItemQuickAddValue, type ItemQuickAddValue } from "../../utils/itemQuickAdd";
import { viewPath } from "../../utils/appHelpers";
import { EXCHANGE_MODE_LABELS } from "../term/components/termLabels";
import { PhotoGalleryField } from "../../components/shared/PhotoGalleryField";
import { FIELD_LABEL, MAX_PRODUCT_PHOTOS, photoFileError, type ItemCreatedState } from "../product/itemPageShared";

const ACTION_CLASS =
  "rounded-[13px] px-4 py-3 text-[13.5px] font-extrabold disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60";
const MISSING_FIELDS_HINT_ID = "item-create-missing-fields";
const TITLE = "Dodaj rzecz";

/** `/add/product`: adds an item to the caller's own inventory — photos,
 * name, condition, category and an optional description — offered at once
 * (Oddam / Zamienię) or saved as a draft — then replaces itself with the
 * new item's page (handing it what could not be saved). A panel view like
 * the other `/add/*` pages; it reads nothing from AppDataContext. */
export function ItemCreateView() {
  const navigate = useNavigate();
  const createItem = useCreateItem();
  const [value, setValue] = useState<ItemQuickAddValue>(createEmptyItemQuickAddValue());
  const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fieldsMissing = value.name.trim() === "" || value.category_id === "";
  const canSubmit = !busy && !fieldsMissing;
  // Missing fields keep the actions focusable (aria-disabled) so the hint reaches
  // keyboard and screen-reader users; only a running save disables them natively.
  const actionState = {
    disabled: busy,
    "aria-disabled": !busy && fieldsMissing ? true : undefined,
    "aria-describedby": fieldsMissing ? MISSING_FIELDS_HINT_ID : undefined,
  };

  async function submit(mode: ListingMode | null) {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const { item, failedPhotos, failedDescription } = await createItem(value, photos, mode);
      const state: ItemCreatedState | undefined =
        failedPhotos > 0 || failedDescription ? { failedPhotos, failedDescription } : undefined;
      navigate(`/product/${item.id}`, { replace: true, state });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się dodać rzeczy.");
      setBusy(false);
    }
  }

  return (
    <section aria-label={TITLE}>
      <SubPageHeader title={TITLE} backTo={viewPath("add")} backLabel="Wróć do dodawania" />
      {/* No submit button: implicit Enter submission from the name input must do nothing. */}
      <form onSubmit={(e) => e.preventDefault()} className="rounded-[22px] border border-line bg-paper p-5">
        <NewPhotosField files={photos} onChange={setPhotos} disabled={busy} />
        <div className="mt-4">
          <ItemQuickAddForm value={value} onChange={setValue} disabled={busy} />
        </div>
        {error && (
          <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
            {error}
          </p>
        )}
        {fieldsMissing && (
          <p id={MISSING_FIELDS_HINT_ID} className="mt-3 text-xs text-ink-soft">
            Podaj nazwę i wybierz kategorię, aby zapisać.
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

/** Local previews of the picked files (object URLs, revoked when the list changes). */
function usePreviewUrls(files: File[]): string[] {
  const urls = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);
  useEffect(() => () => urls.forEach((url) => URL.revokeObjectURL(url)), [urls]);
  return urls;
}

/** Photos kept locally until the item is created, in the order added. */
function NewPhotosField({ files, onChange, disabled }: NewPhotosFieldProps) {
  const [error, setError] = useState<string | null>(null);
  const previews = usePreviewUrls(files);

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
        photos={previews.map((url) => ({ id: url, src: url }))}
        max={MAX_PRODUCT_PHOTOS}
        disabled={disabled}
        onFiles={handleFiles}
        onRemove={(url) => onChange(files.filter((_, i) => previews[i] !== url))}
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
