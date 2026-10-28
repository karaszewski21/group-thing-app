import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ListingMode } from "../../api/itemListingPreferences";
import { ItemQuickAddForm } from "../../components/shared/ItemQuickAddForm";
import { PhoneFrame } from "../../components/shared/PhoneFrame";
import { useCreateItem } from "../../hooks/useCreateItem";
import { createEmptyItemQuickAddValue, type ItemQuickAddValue } from "../../utils/itemQuickAdd";
import { TrashIcon } from "../../components/shared/appIcons";
import { EXCHANGE_MODE_LABELS } from "../term/components/termLabels";
import { ItemBackButton } from "./ItemBackButton";
import { PhotoFileField } from "./ItemGalleryEditor";
import { FIELD_LABEL, MAX_PRODUCT_PHOTOS, photoFileError, type ItemCreatedState } from "./itemPageShared";

const ACTION_CLASS =
  "rounded-[13px] px-4 py-3 text-[13.5px] font-extrabold disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60";
const MISSING_FIELDS_HINT_ID = "item-create-missing-fields";

/** `/add/product`: adds an item to the caller's own inventory with optional
 * photos — offered at once (Oddam / Zamienię) or saved as a draft — then
 * replaces itself with the new item's page (handing it the count of refused
 * photos). Standalone, outside AppDataProvider. */
export function ItemCreatePage() {
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
      const { item, failedPhotos } = await createItem(value, photos, mode);
      const state: ItemCreatedState | undefined = failedPhotos > 0 ? { failedPhotos } : undefined;
      navigate(`/product/${item.id}`, { replace: true, state });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się dodać rzeczy.");
      setBusy(false);
    }
  }

  return (
    <PhoneFrame>
      <div className="flex-1 overflow-y-auto px-[18px] pb-6 pt-[18px]">
        <ItemBackButton />
        <h2 className="text-[19px] font-semibold text-ink">Dodaj rzecz</h2>
        {/* No submit button: implicit Enter submission from the name input must do nothing. */}
        <form onSubmit={(e) => e.preventDefault()} className="mt-4 rounded-[22px] border border-line bg-paper p-5">
          <ItemQuickAddForm value={value} onChange={setValue} disabled={busy} />
          <NewPhotosField files={photos} onChange={setPhotos} disabled={busy} />
          <p className="mt-3 text-xs text-ink-soft">Opis dodasz na stronie rzeczy.</p>
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
      </div>
    </PhoneFrame>
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
  const atLimit = files.length >= MAX_PRODUCT_PHOTOS;

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
    <section aria-labelledby="new-item-photos-heading" className="mt-4">
      <h3 id="new-item-photos-heading" className={FIELD_LABEL}>
        Zdjęcia ({files.length}/{MAX_PRODUCT_PHOTOS})
      </h3>
      {files.length > 0 && (
        <ul className="mt-2 space-y-2">
          {files.map((file, i) => (
            <li key={previews[i]} className="flex items-center gap-2 rounded-2xl border border-line bg-cream p-2">
              <img src={previews[i]} alt="" className="h-12 w-12 flex-none rounded-xl object-cover" />
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink" title={file.name}>
                {i + 1}. {file.name}
              </span>
              <button
                type="button"
                aria-label={`Usuń zdjęcie ${i + 1}`}
                disabled={disabled}
                onClick={() => onChange(files.filter((other) => other !== file))}
                className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[10px] text-ink-soft hover:bg-paper hover:text-danger disabled:opacity-40"
              >
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
      <PhotoFileField disabled={disabled || atLimit} onFiles={handleFiles} />
      {atLimit && <p className="mt-1.5 text-[12.5px] text-ink-soft">Osiągnięto limit {MAX_PRODUCT_PHOTOS} zdjęć.</p>}
      <p className="mt-1.5 text-[11.5px] text-ink-soft">
        Zdjęcia są wspólne dla wszystkich rzeczy tego produktu. Inni zobaczą je po sprawdzeniu.
      </p>
      {error && (
        <p role="alert" className="mt-1.5 text-[12.5px] font-semibold text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
