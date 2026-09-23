import { Avatar } from "../../../components/shared/Avatar";
import type { AvailableItem, KragFamily } from "../../../hooks/useKragGrupy";
import type { FamilyExchangeOffer } from "../../../api/groups";
import type { ReservationType } from "../../../api/reservations";
import { LISTABLE_RESERVATION_TYPES, TAKE_ACTION_LABELS } from "./termLabels";
import { SwapProposeDialog } from "./SwapProposeDialog";

/**
 * The selected family's detail card (`PrivateTermView` only — the public
 * view never fetches per-family exchange data). Shows the family's
 * guardians, and — unless the viewer is looking at their own family (per
 * spec.md Core Requirement 9) — that family's active "Do wymiany w grupie"
 * exchange offers with a take/propose-swap action per offer.
 *
 * All exchange-offer state (which offer's swap dialog is open, busy ids,
 * the swap-dialog's own selection) stays in the caller — this component is
 * purely presentational, driven entirely by props.
 */
export function FamilyCard({
  family,
  isOwnFamily,
  loadingOffers,
  offersError,
  onRetryLoadOffers,
  offers,
  activeSwapOfferId,
  busyTakeListingId,
  swapAvailableItems,
  swapOfferedItemId,
  onSwapOfferedItemChange,
  onTakeButtonClick,
  onConfirmSwap,
  onCancelSwap,
}: {
  family: KragFamily;
  isOwnFamily: boolean;
  loadingOffers: boolean;
  offersError: string | null;
  onRetryLoadOffers: () => void;
  offers: FamilyExchangeOffer[];
  /** The offer id whose swap-propose dialog is currently open, or `null`. */
  activeSwapOfferId: number | null;
  busyTakeListingId: number | null;
  swapAvailableItems: AvailableItem[];
  swapOfferedItemId: number | null;
  onSwapOfferedItemChange: (id: number) => void;
  onTakeButtonClick: (offerId: number, reservationType: ReservationType) => void;
  onConfirmSwap: (offerId: number) => void;
  onCancelSwap: () => void;
}) {
  return (
    <div className="kg-card" key={family.familyId} aria-live="polite">
      <div className="kg-card-top">
        <Avatar name={family.name} className="kg-card-av" />
        <div style={{ minWidth: 0 }}>
          <h3>{family.name}</h3>
          <small>
            {family.guardians.length} {family.guardians.length === 1 ? "opiekun" : "opiekunów"}:{" "}
            {family.guardians.map((g) => g.display_name).join(", ")}
          </small>
        </div>
      </div>

      {!isOwnFamily &&
        (loadingOffers ? (
          <p className="kg-bring-sub" style={{ marginTop: 14 }}>
            Wczytywanie ofert…
          </p>
        ) : offersError ? (
          <p className="kg-bring-sub" style={{ marginTop: 14 }}>
            {offersError}{" "}
            <button type="button" className="kg-btn-ghost" onClick={onRetryLoadOffers}>
              Spróbuj ponownie
            </button>
          </p>
        ) : offers.length > 0 ? (
          <div style={{ marginTop: 14 }} data-testid="family-card-exchange-section">
            <div className="kg-eyebrow" style={{ marginBottom: 8 }}>
              Do wymiany w grupie
            </div>
            {offers.map((offer) => {
              const offeredTypes = offer.offered_types.filter((t): t is ReservationType =>
                LISTABLE_RESERVATION_TYPES.includes(t as ReservationType),
              );
              const primaryType = offeredTypes[0];
              if (!primaryType) return null;
              const isTakingThis = activeSwapOfferId === offer.id;
              return (
                <div key={offer.id} className="kg-bring-item">
                  <div className="kg-bring-row">
                    <div className="kg-bring-body">
                      <strong>{offer.product_name}</strong>
                      <small style={{ color: "var(--sage)", fontWeight: 700 }}>
                        {TAKE_ACTION_LABELS[primaryType]}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="kg-bring-btn"
                      aria-label={`Biorę: ${offer.product_name}`}
                      disabled={busyTakeListingId === offer.id}
                      onClick={() => onTakeButtonClick(offer.id, primaryType)}
                    >
                      Biorę
                    </button>
                  </div>
                  {isTakingThis && (
                    <SwapProposeDialog
                      availableItems={swapAvailableItems}
                      offeredItemId={swapOfferedItemId}
                      onOfferedItemChange={onSwapOfferedItemChange}
                      listingProductName={offer.product_name}
                      busy={busyTakeListingId === offer.id}
                      onConfirm={() => onConfirmSwap(offer.id)}
                      onCancel={onCancelSwap}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ) : null)}
    </div>
  );
}
