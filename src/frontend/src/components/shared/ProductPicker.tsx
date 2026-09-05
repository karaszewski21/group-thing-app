import type { ProductResponse } from "../../api/products";
import type { ProductCategory } from "../../api/products";
import type { ItemCondition } from "../../api/inventories";
import type { ProductPickerValue } from "../../utils/productPicker";
import { CONDITION_LABELS } from "../../utils/productPicker";
import { CATEGORY_LABELS, PRODUCT_CATEGORIES } from "../../utils/productCategory";

interface ProductPickerProps {
  products: ProductResponse[];
  value: ProductPickerValue;
  onChange: (value: ProductPickerValue) => void;
  selectClassName?: string;
  inputClassName?: string;
  rowClassName?: string;
}

/**
 * Pick an existing Product (or create a new one inline) + an ItemCondition
 * — shared between KragGrupyPage's Pledge-fulfill form and PanelPage's
 * "rzeczy" tab "add item" form. Unstyled by default (className props let each consumer
 * apply its own visual system — `.kg-*` classes vs Tailwind utilities).
 */
export function ProductPicker({
  products,
  value,
  onChange,
  selectClassName = "",
  inputClassName = "",
  rowClassName = "",
}: ProductPickerProps) {
  return (
    <>
      <div className={rowClassName}>
        <select
          className={selectClassName}
          value={value.selectedProductId}
          onChange={(e) =>
            onChange({
              ...value,
              selectedProductId: e.target.value === "new" ? "new" : Number(e.target.value),
            })
          }
        >
          <option value="new">+ inny przedmiot</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          className={selectClassName}
          value={value.condition}
          onChange={(e) => onChange({ ...value, condition: e.target.value as ItemCondition })}
        >
          {(Object.keys(CONDITION_LABELS) as ItemCondition[]).map((c) => (
            <option key={c} value={c}>
              {CONDITION_LABELS[c]}
            </option>
          ))}
        </select>
      </div>
      {value.selectedProductId === "new" && (
        <div className={rowClassName}>
          <input
            className={inputClassName}
            placeholder="Nazwa przedmiotu"
            value={value.newProductName}
            onChange={(e) => onChange({ ...value, newProductName: e.target.value })}
          />
          <select
            className={selectClassName}
            value={value.newProductCategory}
            onChange={(e) =>
              onChange({ ...value, newProductCategory: e.target.value as ProductCategory })
            }
          >
            {PRODUCT_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {CATEGORY_LABELS[cat]}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}
