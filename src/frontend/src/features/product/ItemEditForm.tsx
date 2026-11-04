import { useEffect, useId, useRef, useState } from "react";
import type { ItemCondition, ListingStatus } from "../../api/inventories";
import type { ItemDetailsResponse } from "../../api/items";
import { CategoryTreePicker } from "../../components/shared/CategoryTreePicker";
import { LocationPicker } from "../../components/shared/LocationPicker";
import type { useItemEditing } from "../../hooks/useItemDetail";
import { useMyLocations } from "../../hooks/useMyLocations";
import { useNavigationState } from "../../routing/navigation";
import type { PickedLocationState } from "../../utils/appHelpers";
import { ITEM_LOCATION_HELPER, liveLocationId, type ItemEditDraft } from "../../utils/itemQuickAdd";
import { CONDITION_LABELS } from "../../utils/productCategory";
import { FIELD_LABEL, PRODUCT_DESCRIPTION_MAX } from "./itemPageShared";

const INPUT = "rounded-xl border-[1.5px] border-line bg-paper px-3 py-2 text-ink disabled:opacity-60";
const HINT_TEXT = "mt-1.5 text-[11.5px] text-ink-soft";
const ACTION_CLASS = "rounded-[13px] px-4 py-3 text-[13.5px] font-extrabold disabled:opacity-60";
const PLACE_PICKER = "item-edit-place";

const LISTING_STATUS_CHIP: Record<ListingStatus, { label: string; className: string }> = {
  DRAFT: { label: "Wersja robocza", className: "bg-cream text-ink-soft" },
  ACTIVE: { label: "Aktywna", className: "bg-primary-soft text-primary-fg" },
};

type ItemEditing = ReturnType<typeof useItemEditing>;

interface ItemEditFormProps {
  item: ItemDetailsResponse;
  editing: ItemEditing;
  /** The typed values, kept by the host (AppDataContext `itemEdit`). */
  draft: ItemEditDraft;
  onDraftChange: (draft: ItemEditDraft) => void;
  /** The details read failed: photos and the description stay locked until a retry. */
  detailsFailed: boolean;
  onRetryDetails: () => void;
  /** After a successful save. */
  onSaved: () => void;
  onCancel: () => void;
}

/** The item page's sheet in edit mode: name, condition, category,
 * description and the required place, saved together with "Zapisz zmiany".
 * The photos above it are edited in `ItemGalleryEditor` and save at once.
 * Photos and the description belong to the product, so a name/category
 * change (which re-points the item to another product) locks the
 * description until it is saved. An item without a live place (received
 * from someone, or its place deleted) shows a banner and cannot be saved
 * until a place is picked. */
export function ItemEditForm({
  item,
  editing,
  draft,
  onDraftChange,
  detailsFailed,
  onRetryDetails,
  onSaved,
  onCancel,
}: ItemEditFormProps) {
  const nameId = useId();
  const categoryLabelId = useId();
  const conditionId = useId();
  const descriptionId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const { name, categoryId, condition, description } = draft;
  const places = useMyLocations();
  const locationId = liveLocationId(draft.locationId, places);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locationInvalid, setLocationInvalid] = useState(false);
  // Back from /places/new the picker focuses the new place; the name must not take the focus.
  const backFromPlaces = useNavigationState<PickedLocationState>()?.pickedLocation?.picker === PLACE_PICKER;
  const [focusNameOnMount] = useState(!backFromPlaces);

  useEffect(() => {
    if (focusNameOnMount) nameRef.current?.focus();
  }, [focusNameOnMount]);

  const update = (patch: Partial<ItemEditDraft>) => onDraftChange({ ...draft, ...patch });

  const productLocked = !editing.productEditable;
  const trimmedName = name.trim();
  const repoints = trimmedName !== item.name || categoryId !== item.category_id;
  const descriptionLocked = productLocked || repoints;
  const descriptionChanged = !descriptionLocked && description.trim() !== (item.description ?? "").trim();
  const chip = LISTING_STATUS_CHIP[item.listing_status];

  /** Description first, while the item still points at its current product;
   * a partial failure leaves the saved fields matching the refetched item, so
   * a second "Zapisz zmiany" sends only the rest. */
  async function save() {
    if (!trimmedName) {
      setError("Podaj nazwę rzeczy");
      nameRef.current?.focus();
      return;
    }
    if (locationId === null) {
      setLocationInvalid(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (descriptionChanged) await editing.saveDescription(description);
      if (condition !== item.condition) await editing.saveCondition(condition);
      if (locationId !== item.location_id) await editing.saveLocation(locationId);
      if (repoints) await editing.saveNameCategory(trimmedName, categoryId);
      onSaved();
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
      {item.location_id === null && (
        <div role="status" className="mt-3 rounded-[14px] bg-danger-soft px-3.5 py-2.5 text-[12.5px] font-semibold text-danger">
          Ustaw lokalizację, aby wystawić przedmiot.
        </div>
      )}
      {detailsFailed && !busy && (
        <div role="alert" className="mt-3 rounded-[14px] border border-line bg-paper px-3.5 py-2.5 text-[12.5px] text-ink">
          Nie udało się wczytać aktualnych danych produktu — zdjęcia i opis są chwilowo zablokowane.{" "}
          <button type="button" onClick={onRetryDetails} className="font-extrabold text-primary-fg underline">
            Spróbuj ponownie
          </button>
        </div>
      )}
      <p className={HINT_TEXT}>
        Zdjęcia zmieniasz na górze — zapisują się od razu. Są wspólne dla wszystkich rzeczy tego produktu, a inni
        zobaczą je po sprawdzeniu.
      </p>
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
            onChange={(e) => update({ name: e.target.value })}
            className={`w-full min-w-0 font-serif text-[22px] leading-tight font-extrabold ${INPUT}`}
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
            onChange={(e) => update({ condition: e.target.value as ItemCondition })}
            className={`text-[13.5px] ${INPUT}`}
          >
            {(Object.keys(CONDITION_LABELS) as ItemCondition[]).map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span id={categoryLabelId} className={FIELD_LABEL}>
            Kategoria
          </span>
          <CategoryTreePicker
            labelledBy={categoryLabelId}
            value={categoryId}
            onChange={(id) => {
              if (id) update({ categoryId: id });
            }}
            placeholder={item.category_name ?? undefined}
          />
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
            maxLength={PRODUCT_DESCRIPTION_MAX}
            value={description}
            disabled={busy || descriptionLocked}
            aria-describedby={`${descriptionId}-hint`}
            onChange={(e) => update({ description: e.target.value })}
            className={`block w-full resize-y text-[13.5px] ${INPUT}`}
          />
          <p className="text-right text-[11.5px] text-ink-soft">
            {description.length} / {PRODUCT_DESCRIPTION_MAX}
          </p>
          <p id={`${descriptionId}-hint`} className="text-[11.5px] text-ink-soft">
            {repoints
              ? "Opis edytujesz po zapisaniu nowej nazwy lub kategorii."
              : "Opis jest wspólny dla wszystkich rzeczy tego produktu."}
          </p>
        </div>
        {/* Not a <label>: the picker's select carries its own aria-label; this is the visible copy. */}
        <div className="flex min-w-0 flex-col gap-1">
          <span className={FIELD_LABEL}>
            Lokalizacja <span aria-hidden="true">*</span>
          </span>
          <LocationPicker
            value={locationId}
            onChange={(id) => {
              update({ locationId: id });
              if (id !== null) setLocationInvalid(false);
            }}
            label="Lokalizacja"
            idPrefix={PLACE_PICKER}
            required
            invalid={locationInvalid && locationId === null}
          />
          <p className="text-[11.5px] text-ink-soft">{ITEM_LOCATION_HELPER}</p>
        </div>
        {error && (
          <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
            {error}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button type="submit" disabled={busy} className={`${ACTION_CLASS} bg-primary text-on-primary`}>
            {busy ? "Zapisywanie…" : "Zapisz zmiany"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className={`${ACTION_CLASS} border-[1.5px] border-line-strong bg-transparent text-ink`}
          >
            Anuluj
          </button>
        </div>
      </form>
    </>
  );
}
