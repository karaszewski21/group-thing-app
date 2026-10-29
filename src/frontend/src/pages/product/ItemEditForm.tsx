import { useEffect, useId, useRef, useState } from "react";
import type { ItemCondition, ListingStatus } from "../../api/inventories";
import type { ItemDetailsResponse } from "../../api/items";
import { CategoryTreePicker } from "../../components/shared/CategoryTreePicker";
import type { useItemEditing } from "../../hooks/useItemDetail";
import { CONDITION_LABELS } from "../../utils/productCategory";
import { ItemGalleryEditor } from "./ItemGalleryEditor";
import { FIELD_LABEL, MAX_PRODUCT_PHOTOS } from "./itemPageShared";

const DESCRIPTION_MAX = 2000;

const INPUT = "rounded-xl border-[1.5px] border-line bg-paper px-3 py-2 text-ink disabled:opacity-60";
const HINT_TEXT = "mt-1.5 text-[11.5px] text-ink-soft";
const ACTION_CLASS = "rounded-[13px] px-4 py-3 text-[13.5px] font-extrabold disabled:opacity-60";

const LISTING_STATUS_CHIP: Record<ListingStatus, { label: string; className: string }> = {
  DRAFT: { label: "Wersja robocza", className: "bg-cream text-ink-soft" },
  ACTIVE: { label: "Aktywna", className: "bg-primary-soft text-primary-fg" },
};

type ItemEditing = ReturnType<typeof useItemEditing>;

interface ItemEditFormProps {
  item: ItemDetailsResponse;
  editing: ItemEditing;
  /** The details read failed: photos and the description stay locked until a retry. */
  detailsFailed: boolean;
  onRetryDetails: () => void;
  onDone: () => void;
}

/** The item page in edit mode: name and description as text fields,
 * category and condition as pickers, saved together with "Zapisz". Photos
 * are edited one by one and save at once, like before. Photos and the
 * description belong to the product, so a name/category change (which
 * re-points the item to another product) locks the description until it is
 * saved. */
export function ItemEditForm({ item, editing, detailsFailed, onRetryDetails, onDone }: ItemEditFormProps) {
  const nameId = useId();
  const categoryLabelId = useId();
  const conditionId = useId();
  const descriptionId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(item.name);
  const [categoryId, setCategoryId] = useState(item.category_id);
  const [condition, setCondition] = useState<ItemCondition>(item.condition);
  const [description, setDescription] = useState(item.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const productLocked = !editing.productEditable;
  const trimmedName = name.trim();
  const repoints = trimmedName !== item.name || categoryId !== item.category_id;
  const descriptionLocked = productLocked || repoints;
  const descriptionChanged = !descriptionLocked && description.trim() !== (item.description ?? "").trim();
  const chip = LISTING_STATUS_CHIP[item.listing_status];

  /** Description first, while the item still points at its current product;
   * a partial failure leaves the saved fields matching the refetched item, so
   * a second "Zapisz" sends only the rest. */
  async function save() {
    if (!trimmedName) {
      setError("Podaj nazwę rzeczy");
      nameRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (descriptionChanged) await editing.saveDescription(description);
      if (condition !== item.condition) await editing.saveCondition(condition);
      if (repoints) await editing.saveNameCategory(trimmedName, categoryId);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <h2 className={FIELD_LABEL}>Edycja rzeczy</h2>
        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11.5px] font-extrabold ${chip.className}`}>
          {chip.label}
        </span>
      </div>
      {detailsFailed && !busy && (
        <div role="alert" className="mt-3 rounded-[14px] border border-line bg-paper px-3.5 py-2.5 text-[12.5px] text-ink">
          Nie udało się wczytać aktualnych danych produktu — zdjęcia i opis są chwilowo zablokowane.{" "}
          <button type="button" onClick={onRetryDetails} className="font-extrabold text-primary-fg underline">
            Spróbuj ponownie
          </button>
        </div>
      )}
      <form
        aria-label="Edycja rzeczy"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void save();
        }}
        className="mt-3 flex flex-col gap-3"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={nameId} className={FIELD_LABEL}>
            Nazwa
          </label>
          <input
            ref={nameRef}
            id={nameId}
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            className={`w-full min-w-0 font-serif text-[22px] leading-tight font-extrabold ${INPUT}`}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span id={categoryLabelId} className={FIELD_LABEL}>
              Kategoria
            </span>
            <CategoryTreePicker
              labelledBy={categoryLabelId}
              value={categoryId}
              onChange={(id) => {
                if (id) setCategoryId(id);
              }}
              placeholder={item.category_name ?? undefined}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor={conditionId} className={FIELD_LABEL}>
              Stan
            </label>
            <select
              id={conditionId}
              value={condition}
              disabled={busy}
              onChange={(e) => setCondition(e.target.value as ItemCondition)}
              className={`text-[13.5px] ${INPUT}`}
            >
              {(Object.keys(CONDITION_LABELS) as ItemCondition[]).map((c) => (
                <option key={c} value={c}>
                  {CONDITION_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
        </div>
        {repoints && (
          <p className="text-[11.5px] text-ink-soft">
            Ta zmiana podepnie rzecz pod inny produkt z katalogu — innych rzeczy nie zmienia. Zdjęcia i opis
            należą do produktu — po zmianie nazwy lub kategorii rzecz pokaże zdjęcia i opis nowego produktu.
          </p>
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor={descriptionId} className={FIELD_LABEL}>
            Opis
          </label>
          <textarea
            id={descriptionId}
            rows={5}
            maxLength={DESCRIPTION_MAX}
            value={description}
            disabled={busy || descriptionLocked}
            aria-describedby={`${descriptionId}-hint`}
            onChange={(e) => setDescription(e.target.value)}
            className={`block w-full resize-y text-[13.5px] ${INPUT}`}
          />
          <p className="text-right text-[11.5px] text-ink-soft">
            {description.length} / {DESCRIPTION_MAX}
          </p>
          <p id={`${descriptionId}-hint`} className="text-[11.5px] text-ink-soft">
            {repoints
              ? "Opis edytujesz po zapisaniu nowej nazwy lub kategorii."
              : "Opis jest wspólny dla wszystkich rzeczy tego produktu."}
          </p>
        </div>
        {error && (
          <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
            {error}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button type="submit" disabled={busy} className={`${ACTION_CLASS} bg-primary text-on-primary`}>
            {busy ? "Zapisywanie…" : "Zapisz"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onDone}
            className={`${ACTION_CLASS} border-[1.5px] border-line-strong bg-transparent text-ink`}
          >
            Anuluj
          </button>
        </div>
      </form>

      <section aria-labelledby="item-photos-edit-heading" className="mt-4 rounded-3xl border border-line bg-paper p-5">
        <h3 id="item-photos-edit-heading" className={FIELD_LABEL}>
          Zdjęcia ({item.photos.length}/{MAX_PRODUCT_PHOTOS})
        </h3>
        <ItemGalleryEditor
          photos={item.photos}
          busy={editing.photoBusy || productLocked}
          onAdd={editing.addPhoto}
          onRemove={editing.removePhoto}
          onMove={editing.movePhoto}
        />
        <p className={HINT_TEXT}>Zmiany zdjęć zapisują się od razu.</p>
      </section>
    </>
  );
}
