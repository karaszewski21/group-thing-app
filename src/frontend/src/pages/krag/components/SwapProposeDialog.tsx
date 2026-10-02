import { ModalSheet } from "../../../components/krag/ModalSheet";

/** One of the viewer's own items that can be offered in a swap. */
export interface AvailableItem {
  id: string;
  productName: string;
}

/** Swap-offer picker — exactly ONE offered item plus an explicit trade
 * preview ("Twoja rzecz X za ich rzecz Y"). Submitting calls `onConfirm`
 * (wired to `proposeSwap`) — a SWAP is always a proposal the listing owner
 * must separately accept/reject, never a single-shot take. Bottom-sheet
 * modal, same `ModalSheet` chrome as `AuthGateSheet`/`RsvpDialog`. */
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
  const offered = availableItems.find((i) => i.id === offeredItemId) ?? null;
  return (
    <ModalSheet title="Zaproponuj zamianę" onClose={onCancel}>
      {availableItems.length === 0 ? (
        <p className="mb-1.5 mt-0.5 text-[13px] text-ink-soft">
          Nie masz żadnej rzeczy oznaczonej "zamienię". Oznacz rzecz w "Moje rzeczy", aby móc
          zaproponować zamianę.
        </p>
      ) : (
        <>
          <div className="mb-3.5">
            <select
              className="kg-select"
              aria-label="Twoja rzecz do zamiany"
              value={offeredItemId ?? ""}
              onChange={(e) => onOfferedItemChange(e.target.value)}
            >
              {availableItems.map((mi) => (
                <option key={mi.id} value={mi.id}>
                  {mi.productName}
                </option>
              ))}
            </select>
          </div>
          {offered && (
            <p className="mb-1.5 mt-0.5 text-[13px] text-ink-soft">
              Twoja rzecz <strong>{offered.productName}</strong> za ich rzecz{" "}
              <strong>{listingProductName}</strong>
            </p>
          )}
        </>
      )}
      <div className="mt-3.5 flex gap-2">
        <button
          type="button"
          className="kg-btn-primary flex-1"
          disabled={busy || offeredItemId === null}
          onClick={onConfirm}
        >
          Zaproponuj zamianę
        </button>
        <button type="button" className="kg-btn-ghost flex-1" onClick={onCancel}>
          Anuluj
        </button>
      </div>
    </ModalSheet>
  );
}
