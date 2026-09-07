import type { ItemCondition } from "../../api/inventories";
import type { ProductCategory } from "../../api/products";
import type { ItemQuickAddValue } from "../../utils/itemQuickAdd";
import { CONDITION_LABELS } from "../../utils/productPicker";
import { CATEGORY_LABELS, PRODUCT_CATEGORIES } from "../../utils/productCategory";

const inputClass =
  "min-w-0 flex-1 rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink";
const labelClass = "text-xs font-extrabold tracking-wide text-ink-soft";

interface ItemQuickAddFormProps {
  value: ItemQuickAddValue;
  onChange: (value: ItemQuickAddValue) => void;
  disabled?: boolean;
}

/**
 * Freeform "add item" form — Nazwa (name) / Stan (condition) / Typ (category).
 * Replaces the `ProductPicker` catalog-select flow: purely presentational and
 * prop-configured, no API calls inside the component itself — callers own
 * submission (resolving the `Product` via `resolveProduct()`, then
 * `registerInventoryItem`). Shared by PanelPage's "+ Dodaj rzecz" modal and
 * the onboarding wizard's item step.
 */
export function ItemQuickAddForm({ value, onChange, disabled = false }: ItemQuickAddFormProps) {
  return (
    <div className="flex flex-col gap-3">
      <Field label="Nazwa">
        <input
          className={inputClass}
          placeholder="np. Rowerek biegowy"
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          disabled={disabled}
        />
      </Field>

      <Field label="Stan">
        <select
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

      <Field label="Typ">
        <select
          className={inputClass}
          value={value.category}
          onChange={(e) => onChange({ ...value, category: e.target.value as ProductCategory })}
          disabled={disabled}
        >
          {PRODUCT_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {CATEGORY_LABELS[cat]}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  );
}
