import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ItemQuickAddForm } from "../../components/shared/ItemQuickAddForm";
import { PhoneFrame } from "../../components/shared/PhoneFrame";
import { useCategories } from "../../hooks/useCategories";
import { useCreateItem } from "../../hooks/useCreateItem";
import { createEmptyItemQuickAddValue, type ItemQuickAddValue } from "../../utils/itemQuickAdd";
import { isValidImageUrl } from "../../utils/url";
import { PanelNavBar } from "../panel/PanelNav";
import { TrashIcon } from "../panel/panelIcons";
import { ItemBackButton } from "./ItemBackButton";
import { SafeImage } from "./ItemGallery";
import { PhotoUrlField } from "./ItemGalleryEditor";
import {
  FIELD_LABEL,
  INVALID_PHOTO_URL_MESSAGE,
  MAX_PRODUCT_PHOTOS,
  type ItemCreatedState,
} from "./itemPageShared";

/** `/product/new`: adds an item to the caller's own inventory with optional
 * photo links, then replaces itself with the new item's page (handing it the
 * count of refused photos). Standalone, outside PanelDataProvider. */
export function ItemCreatePage() {
  const navigate = useNavigate();
  const createItem = useCreateItem();
  const { data: categories } = useCategories();
  const [draft, setDraft] = useState<ItemQuickAddValue>(createEmptyItemQuickAddValue());
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Categories load asynchronously, so the default (first) category is
  // derived until the user picks one.
  const value = { ...draft, category_id: draft.category_id || (categories[0]?.id ?? "") };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!value.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { item, failedPhotos } = await createItem(value, photoUrls);
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
        <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 rounded-[22px] border border-line bg-paper p-5">
          <ItemQuickAddForm value={value} onChange={setDraft} disabled={busy} />
          <NewPhotosField urls={photoUrls} onChange={setPhotoUrls} disabled={busy} />
          <p className="mt-3 text-xs text-ink-soft">
            Opis dodasz na stronie rzeczy, a sposób udostępnienia (wypożyczę / oddam / zamienię) ustawisz na
            liście „Moje rzeczy”.
          </p>
          {error && (
            <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || !value.name.trim()}
            className="mt-4 w-full rounded-[13px] bg-mint px-5 py-3 text-[13.5px] font-extrabold text-white disabled:opacity-60"
          >
            Dodaj rzecz
          </button>
        </form>
      </div>
      <PanelNavBar active="rzeczy" />
    </PhoneFrame>
  );
}

interface NewPhotosFieldProps {
  urls: string[];
  onChange: (urls: string[]) => void;
  disabled: boolean;
}

/** Photo links kept locally until the item is created, in the order added. */
function NewPhotosField({ urls, onChange, disabled }: NewPhotosFieldProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const atLimit = urls.length >= MAX_PRODUCT_PHOTOS;

  function handleAdd() {
    const trimmed = url.trim();
    if (!isValidImageUrl(trimmed)) {
      setError(INVALID_PHOTO_URL_MESSAGE);
      return;
    }
    if (urls.includes(trimmed)) {
      setError("To zdjęcie jest już na liście.");
      return;
    }
    setError(null);
    onChange([...urls, trimmed]);
    setUrl("");
  }

  return (
    <section aria-labelledby="new-item-photos-heading" className="mt-4">
      <h3 id="new-item-photos-heading" className={FIELD_LABEL}>
        Zdjęcia ({urls.length}/{MAX_PRODUCT_PHOTOS})
      </h3>
      {urls.length > 0 && (
        <ul className="mt-2 space-y-2">
          {urls.map((u, i) => (
            <li key={u} className="flex items-center gap-2 rounded-2xl border border-line bg-cream p-2">
              <SafeImage src={u} alt="" className="h-12 w-12 flex-none rounded-xl" placeholderSize={20} />
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink" title={u}>
                {i + 1}. {u}
              </span>
              <button
                type="button"
                aria-label={`Usuń zdjęcie ${i + 1}`}
                disabled={disabled}
                onClick={() => onChange(urls.filter((other) => other !== u))}
                className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[10px] text-ink-soft hover:bg-paper hover:text-danger disabled:opacity-40"
              >
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
      <PhotoUrlField value={url} disabled={disabled || atLimit} onChange={setUrl} onAdd={handleAdd} />
      {atLimit && <p className="mt-1.5 text-[12.5px] text-ink-soft">Osiągnięto limit {MAX_PRODUCT_PHOTOS} zdjęć.</p>}
      <p className="mt-1.5 text-[11.5px] text-ink-soft">Zdjęcia są wspólne dla wszystkich rzeczy tego produktu.</p>
      {error && (
        <p role="alert" className="mt-1.5 text-[12.5px] font-semibold text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
