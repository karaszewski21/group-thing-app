import type { ExchangeMode } from "../../api/groups";
import { ModalSheet } from "../../components/shared/ModalSheet";
import { BTN_GHOST, BTN_LG, BTN_PRIMARY } from "../../components/shared/uiStyles";

interface PersonalPickupSheetProps {
  ownerName: string;
  itemName: string;
  /** The owner's place as the viewer sees it: the name only. */
  locationName: string;
  mode: ExchangeMode;
  /** Reserves (GIFT) or continues to the swap picker (SWAP) for a personal pickup. */
  onConfirm: () => void;
  onClose: () => void;
}

/** "Odbiorę osobiście": the owner's place by name, the address-in-chat
 * note and what happens next. The address is never shown here. */
export function PersonalPickupSheet({ ownerName, itemName, locationName, mode, onConfirm, onClose }: PersonalPickupSheetProps) {
  return (
    <ModalSheet title="Odbiór osobisty" onClose={onClose}>
      <div className="rounded-2xl border border-line bg-paper p-3">
        <p className="text-sm font-extrabold wrap-break-word text-ink">
          <span aria-hidden="true">📍</span> {locationName}
        </p>
        <p className="mt-0.5 text-xs text-ink-soft">
          {`Dokładny adres i godzinę ustalicie z ${ownerName} na czacie — nie udostępniamy adresu w aplikacji.`}
        </p>
      </div>
      <p className="mt-3 text-[13px] text-ink">
        {mode === "SWAP" ? (
          <>
            Zaproponujesz zamianę za <b>{itemName}</b>
            {`. Gdy ${ownerName} ją przyjmie i się wymienicie, potwierdźcie to na tej stronie.`}
          </>
        ) : (
          <>
            Zarezerwujemy dla Ciebie <b>{itemName}</b>. Gdy odbierzesz rzecz, potwierdź przekazanie na tej stronie.
          </>
        )}
      </p>
      <button type="button" onClick={onConfirm} className={`${BTN_PRIMARY} ${BTN_LG} mt-4 block w-full text-center`}>
        {`Rezerwuję i piszę do ${ownerName}`}
      </button>
      <button type="button" onClick={onClose} className={`${BTN_GHOST} ${BTN_LG} mt-2.5 block w-full text-center text-ink`}>
        Anuluj
      </button>
    </ModalSheet>
  );
}
