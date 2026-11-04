import { ModalSheet } from "../../components/shared/ModalSheet";
import { BTN_GHOST, BTN_PRIMARY, BTN_SM } from "../../components/shared/uiStyles";
import type { ItemCondition } from "../../api/inventories";
import { CONDITION_LABELS } from "../../utils/productCategory";

/** One of the viewer's own items that can be offered in a swap. */
export interface AvailableItem {
  id: string;
  productName: string;
  condition: ItemCondition;
}

/** "Co proponujesz w zamian?" — the viewer picks exactly ONE of their own
 * swap-listed items. Submitting calls `onConfirm` (a term or event proposal) —
 * a SWAP is always a proposal the listing owner must separately
 * accept/reject, never a single-shot take. */
export function SwapProposeDialog({
  availableItems,
  offeredItemId,
  onOfferedItemChange,
  listingProductName,
  onConfirm,
  onCancel,
  busy,
}: {
  availableItems: AvailableItem[];
  offeredItemId: string | null;
  onOfferedItemChange: (id: string) => void;
  listingProductName: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <ModalSheet
      title="Co proponujesz w zamian?"
      ariaLabel={`Co proponujesz w zamian za „${listingProductName}”?`}
      onClose={onCancel}
    >
      {availableItems.length === 0 ? (
        <p className="mb-1.5 mt-0.5 text-[13px] text-ink-soft">
          Nie masz żadnej rzeczy oznaczonej "zamienię". Oznacz rzecz w "Moje rzeczy", aby móc
          zaproponować zamianę.
        </p>
      ) : (
        <fieldset>
          <legend className="text-[13px] text-ink-soft">Twoje rzeczy wystawione do zamiany</legend>
          {availableItems.map((mi) => (
            <label
              key={mi.id}
              className="mt-2 flex cursor-pointer items-center gap-3 rounded-2xl border-[1.5px] border-line p-2.5 has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus-ring"
            >
              <input
                type="radio"
                name="offered-item"
                value={mi.id}
                checked={offeredItemId === mi.id}
                onChange={() => onOfferedItemChange(mi.id)}
                className="sr-only"
              />
              <span>
                <strong className="block text-sm text-ink">{mi.productName}</strong>
                <small className="text-xs text-ink-soft">{CONDITION_LABELS[mi.condition] ?? mi.condition}</small>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="mt-3.5 flex gap-2">
        <button type="button" className={`${BTN_GHOST} ${BTN_SM} flex-1`} onClick={onCancel}>
          Anuluj
        </button>
        <button
          type="button"
          className={`${BTN_PRIMARY} ${BTN_SM} flex-1`}
          disabled={busy || offeredItemId === null}
          onClick={onConfirm}
        >
          Zaproponuj zamianę
        </button>
      </div>
    </ModalSheet>
  );
}
