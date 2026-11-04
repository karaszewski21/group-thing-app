import { useId } from "react";
import type { ItemCondition } from "../../api/inventories";
import type { ItemQuickAddValue } from "../../utils/itemQuickAdd";
import { PRODUCT_DESCRIPTION_MAX } from "../../features/product/itemPageShared";
import { CONDITION_LABELS } from "../../utils/productCategory";
import { Field } from "./appComponents";
import { CategoryTreePicker } from "./CategoryTreePicker";

const inputClass =
  "min-w-0 flex-1 rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink";

interface ItemQuickAddFormProps {
  value: ItemQuickAddValue;
  onChange: (value: ItemQuickAddValue) => void;
  disabled?: boolean;
}

/**
 * Freeform "add item" form — Nazwa (name) / Stan (condition) / Kategoria
 * (required leaf category, no default) / Opis (optional). Purely presentational: the caller
 * owns submission (`resolveProduct()`, then `registerInventoryItem`) and renders the
 * required place picker below it, writing `location_id`. Used by `ItemCreateView`
 * (`/add/product`).
 */
export function ItemQuickAddForm({ value, onChange, disabled = false }: ItemQuickAddFormProps) {
  const id = useId();
  const categoryLabelId = `${id}-category`;

  return (
    <div className="flex flex-col gap-3">
      <Field label="Nazwa" required htmlFor={`${id}-name`}>
        <input
          id={`${id}-name`}
          className={inputClass}
          placeholder="np. Rowerek biegowy"
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          disabled={disabled}
        />
      </Field>

      <Field label="Stan" htmlFor={`${id}-condition`}>
        <select
          id={`${id}-condition`}
          className={inputClass}
          value={value.condition}
          onChange={(e) => onChange({ ...value, condition: e.target.value as ItemCondition })}
          disabled={disabled}
        >
          {(Object.keys(CONDITION_LABELS) as ItemCondition[]).map((c) => (
            <option key={c} value={c}>
              {CONDITION_LABELS[c]}
            </option>
          ))}
        </select>
      </Field>

      {/* The picker's trigger is a button labelled by the span, never inside a <label>. */}
      <Field label="Kategoria" required labelId={categoryLabelId}>
        <CategoryTreePicker
          labelledBy={categoryLabelId}
          value={value.category_id || null}
          onChange={(id) => onChange({ ...value, category_id: id ?? "" })}
          disabled={disabled}
        />
      </Field>

      <Field label="Opis" htmlFor={`${id}-description`}>
        <textarea
          id={`${id}-description`}
          className={`${inputClass} resize-y`}
          rows={4}
          maxLength={PRODUCT_DESCRIPTION_MAX}
          placeholder="Rozmiar, wady, co jest w zestawie"
          value={value.description}
          onChange={(e) => onChange({ ...value, description: e.target.value })}
          disabled={disabled}
        />
      </Field>
    </div>
  );
}
