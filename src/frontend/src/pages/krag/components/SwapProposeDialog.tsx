import type { AvailableItem } from "../../../hooks/useKragGrupy";

/** Group 7's swap-offer dialog — a single-item picker (V1 scope: exactly
 * ONE offered item, never a multi-select) plus an explicit trade preview
 * ("Twoja rzecz X za ich rzecz Y"), used at every "Rzeczy od innych"/
 * "Rzeczy do wymiany"/family-card take-SWAP call site on both `PrivateTermView`
 * and `PublicTermView`. Submitting calls the caller's `onConfirm` (wired to
 * `proposeSwap` on either side) — a SWAP is always a proposal the listing
 * owner must separately accept/reject, never a single-shot take. */
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
  offeredItemId: number | null;
  onOfferedItemChange: (id: number) => void;
  listingProductName: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const offered = availableItems.find((i) => i.id === offeredItemId) ?? null;
  return (
    <div className="kg-fulfill">
      {availableItems.length === 0 ? (
        <p className="kg-bring-sub" style={{ marginTop: 2, marginBottom: 6 }}>
          Nie masz żadnej rzeczy oznaczonej "zamienię". Oznacz rzecz w "Moje rzeczy", aby móc
          zaproponować zamianę.
        </p>
      ) : (
        <>
          <div className="kg-fulfill-row">
            <select
              className="kg-select"
              aria-label="Twoja rzecz do zamiany"
              value={offeredItemId ?? ""}
              onChange={(e) => onOfferedItemChange(Number(e.target.value))}
            >
              {availableItems.map((mi) => (
                <option key={mi.id} value={mi.id}>
                  {mi.productName}
                </option>
              ))}
            </select>
          </div>
          {offered && (
            <p className="kg-bring-sub" style={{ marginTop: 2, marginBottom: 6 }}>
              Twoja rzecz <strong>{offered.productName}</strong> za ich rzecz{" "}
              <strong>{listingProductName}</strong>
            </p>
          )}
        </>
      )}
      <div className="kg-fulfill-actions">
        <button
          type="button"
          className="kg-btn-primary"
          disabled={busy || offeredItemId === null}
          onClick={onConfirm}
        >
          Zaproponuj zamianę
        </button>
        <button type="button" className="kg-btn-ghost" onClick={onCancel}>
          Anuluj
        </button>
      </div>
    </div>
  );
}
