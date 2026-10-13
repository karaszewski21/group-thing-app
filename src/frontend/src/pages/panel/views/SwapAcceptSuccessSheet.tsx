import { AddToCalendarButton } from "../../../components/shared/AddToCalendarButton";
import { calendarUid } from "../../../utils/calendar";
import dayjs from "../../../utils/dayjs";
import { organizerTermPath } from "../../organizer/organizerHelpers";
import { ModalSheet } from "../panelComponents";

export interface AcceptedSwap {
  myItemName: string;
  offeredName: string;
  occursOn: string | null;
  groupName: string | null;
  groupId: string | null;
  termId: string | null;
  itemId: string;
  hadOtherOffers: boolean;
}

/** "Zamiana zaakceptowana" sheet after the owner picks a swap offer. Without
 * term data (degraded response) it omits the date line and the calendar. */
export function SwapAcceptSuccessSheet({ swap, onClose }: { swap: AcceptedSwap; onClose: () => void }) {
  const { myItemName, offeredName, occursOn, groupName, groupId, termId, itemId, hadOtherOffers } = swap;
  const hasTerm = occursOn !== null && groupName !== null && groupId !== null && termId !== null;

  return (
    <ModalSheet title="Zamiana zaakceptowana" onClose={onClose}>
      <div className="text-[15px] font-extrabold text-ink">
        <p>
          „{myItemName}” ↔ „{offeredName}”
        </p>
        {hasTerm && <p>{dayjs(occursOn).format("ddd DD.MM [o] HH:mm")}</p>}
        {groupName !== null && <p>— {groupName}</p>}
      </div>
      <p className="mt-3 text-sm text-ink-soft">
        Przynieś „{myItemName}” i odbierz „{offeredName}” na tym terminie.
      </p>
      {hadOtherOffers && <p className="mt-1 text-xs text-ink-soft">Pozostałe propozycje zostały odrzucone.</p>}

      <div className="mt-5 flex flex-col gap-2 min-[520px]:flex-row min-[520px]:flex-wrap">
        {hasTerm && (
          <div className="min-[520px]:flex-1">
            <AddToCalendarButton
              size="lg"
              direction="up"
              event={{
                uid: calendarUid(termId, itemId),
                title: `Zamiana: ${myItemName} ↔ ${offeredName}`,
                occursOn,
                groupName,
                url: window.location.origin + organizerTermPath("krag", groupId, termId),
              }}
            />
          </div>
        )}
        <button
          type="button"
          onClick={onClose}
          className="min-h-10 rounded-full bg-primary px-3.5 text-[13px] font-extrabold text-on-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring min-[520px]:flex-1"
        >
          Gotowe
        </button>
      </div>
    </ModalSheet>
  );
}
