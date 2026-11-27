import { useEffect, useId, useRef, useState } from "react";
import type { ItemCondition, ListingStatus } from "../../api/inventories";
import type { ItemDetailsResponse } from "../../api/items";
import { CategoryTreePicker } from "../../components/shared/CategoryTreePicker";
import { ItemPointsPreview } from "../../components/shared/ItemPointsPreview";
import { LocationPicker } from "../../components/shared/LocationPicker";
import { PointsPriceStepper } from "../../components/shared/PointsPriceStepper";
import { useItemActions } from "../../hooks/useItemActions";
import type { useItemEditing } from "../../hooks/useItemDetail";
import { useItemPointsPreview, useOwnedItemPointsValue } from "../../hooks/useItemPointsPreview";
import { useMyLocations } from "../../hooks/useMyLocations";
import { useNavigationState } from "../../routing/navigation";
import { clampPointsPrice, parsePointsPrice, type PickedLocationState, type PointsPriceBounds } from "../../utils/appHelpers";
import { ITEM_LOCATION_HELPER, liveLocationId, type ItemEditDraft } from "../../utils/itemQuickAdd";
import { CONDITION_LABELS } from "../../utils/productCategory";
import { FIELD_LABEL, PRODUCT_DESCRIPTION_MAX } from "./itemPageShared";

const INPUT = "rounded-xl border-[1.5px] border-line bg-paper px-3 py-2 text-ink disabled:opacity-60";
const HINT_TEXT = "mt-1.5 text-[11.5px] text-ink-soft";
const ACTION_CLASS = "rounded-[13px] px-4 py-3 text-[13.5px] font-extrabold disabled:opacity-60";
const PLACE_PICKER = "item-edit-place";
const PRICE_ID = "item-edit-points-price";

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

  // POINTS: the stepper checks against the stored value's bounds (what the
  // server checks the PUT against); after a category or condition change the
  // preview of the value the PATCH will store stands in, as a forecast.
  const actions = useItemActions(item.id).data;
  const listedPrice = actions?.mode === "POINTS" ? actions.points_price : null;
  const isPoints = listedPrice !== null;
  const owned = useOwnedItemPointsValue(isPoints ? item.id : null);
  const preview = useItemPointsPreview(categoryId, condition);
  const conditionChanged = condition !== item.condition;
  const revalued = conditionChanged || categoryId !== item.category_id;
  const valuation = revalued ? preview : owned;
  const priceBounds = isPoints ? valuation.bounds : null;
  const priceTouched = draft.pointsPrice !== null;
  const priceText =
    draft.pointsPrice ?? (listedPrice === null ? "" : String(priceBounds ? clampPointsPrice(listedPrice, priceBounds) : listedPrice));
  const parsedPrice = priceBounds ? parsePointsPrice(priceText, priceBounds) : undefined;
  const priceInvalid = isPoints && priceTouched && typeof parsedPrice !== "number";
  const priceToSave =
    isPoints && typeof parsedPrice === "number" && (parsedPrice !== listedPrice || revalued) ? parsedPrice : null;
  const heldPoints = actions?.party_reservation?.held_points ?? null;

  /** Description first, while the item still points at its current product;
   * a partial failure leaves the saved fields matching the refetched item, so
   * a second "Zapisz zmiany" sends only the rest. The POINTS price goes last,
   * after the PATCH has stored the new value (and clamped the old price). */
  async function save() {
    if (priceInvalid) return;
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
      if (priceToSave !== null) await editing.savePointsPrice(priceToSave);
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
        {isPoints ? (
          <div className="flex min-w-0 flex-col gap-2">
            {revalued && priceBounds && valuation.data !== null && (
              <p className="rounded-[14px] bg-accent-soft px-3.5 py-2.5 text-[12.5px] font-semibold text-accent-fg">
                {forecastText(conditionChanged, categoryId !== item.category_id, valuation.data, priceBounds, listedPrice)}
              </p>
            )}
            {priceBounds && valuation.data !== null ? (
              <PointsPriceStepper
                id={PRICE_ID}
                value={priceText}
                onChange={(text) => update({ pointsPrice: text })}
                bounds={priceBounds}
                suggestion={valuation.data}
                disabled={busy}
              />
            ) : (
              <p aria-live="polite" className="text-[12.5px] text-ink-soft">
                {valuation.error ? "Nie udało się wyliczyć ceny w punktach." : "Liczę cenę w punktach…"}
              </p>
            )}
            {heldPoints !== null && (
              <p className="text-[12.5px] text-ink-soft">
                Zarezerwowana przez {actions?.reservation?.by_name ?? "inną osobę"} za {heldPoints} pkt — ta rezerwacja
                rozliczy się po {heldPoints} pkt. Nowa cena dotyczy kolejnych osób.
              </p>
            )}
          </div>
        ) : (
          <ItemPointsPreview categoryId={categoryId} condition={condition} />
        )}
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
          <button type="submit" disabled={busy || priceInvalid} className={`${ACTION_CLASS} bg-primary text-on-primary`}>
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

/** The note over the stepper after a category or condition change: the
 * forecast bounds and what happens to the current price if left as it is. */
function forecastText(
  conditionChanged: boolean,
  categoryChanged: boolean,
  suggestion: number,
  bounds: PointsPriceBounds,
  listedPrice: number,
): string {
  const what = conditionChanged && categoryChanged ? "kategorię i stan" : conditionChanged ? "stan" : "kategorię";
  const head = `Zmieniłeś ${what} — sugestia to teraz ${suggestion} pkt (dozwolone ${bounds.min}–${bounds.max}).`;
  const clamped = clampPointsPrice(listedPrice, bounds);
  const tail =
    clamped === listedPrice
      ? `Twoja cena ${listedPrice} pkt mieści się w zakresie.`
      : `Bez nowej ceny zapisana cena ${listedPrice} pkt zostanie docięta do ${clamped} pkt.`;
  return `${head} ${tail}`;
}
