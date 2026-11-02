import { Link } from "../../routing/navigation";
import { AddToCalendarButton } from "../../components/shared/AddToCalendarButton";
import { useOrigin } from "../../lib/useClientValue";
import { calendarUid } from "../../utils/calendar";
import { eventPath } from "../../routing/paths";
import dayjs from "../../utils/dayjs";
import { organizerTermPath } from "../owner-page/organizerHelpers";
import { ModalSheet } from "../../components/shared/appComponents";

export interface AcceptedSwap {
  myItemName: string;
  offeredName: string;
  occursOn: string | null;
  groupName: string | null;
  groupId: string | null;
  termId: string | null;
  /** Set for an event swap; `groupName` is then the event name. */
  eventId: string | null;
  eventSlug: string | null;
  itemId: string;
  hadOtherOffers: boolean;
}

/** Where the swap happens: the Term or, for an event swap, the event. */
function swapContext(swap: AcceptedSwap): { id: string; path: string; isEvent: boolean } | null {
  const { groupId, termId, eventId, eventSlug } = swap;
  if (eventId !== null && eventSlug !== null) return { id: eventId, path: eventPath(eventSlug, eventId), isEvent: true };
  if (groupId !== null && termId !== null) return { id: termId, path: organizerTermPath("krag", groupId, termId), isEvent: false };
  return null;
}

/** "Zamiana zaakceptowana" sheet after the owner picks a swap offer. Without
 * term or event data (degraded response) it omits the date line and the
 * calendar. */
export function SwapAcceptSuccessSheet({ swap, onClose }: { swap: AcceptedSwap; onClose: () => void }) {
  const { myItemName, offeredName, occursOn, groupName, itemId, hadOtherOffers } = swap;
  const origin = useOrigin();
  const context = swapContext(swap);
  const hasTerm = occursOn !== null && groupName !== null && context !== null;

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
        Przynieś „{myItemName}” i odbierz „{offeredName}” {context?.isEvent ? "na tym wydarzeniu" : "na tym terminie"}.
      </p>
      {context?.isEvent && (
        <p className="mt-2 text-sm">
          <Link
            to={context.path}
            onClick={onClose}
            className="font-bold text-primary underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            Zobacz wydarzenie
          </Link>
        </p>
      )}
      {hadOtherOffers && <p className="mt-1 text-xs text-ink-soft">Pozostałe propozycje zostały odrzucone.</p>}

      <div className="mt-5 flex flex-col gap-2 min-[520px]:flex-row min-[520px]:flex-wrap">
        {hasTerm && (
          <div className="min-[520px]:flex-1">
            <AddToCalendarButton
              size="lg"
              direction="up"
              event={{
                uid: calendarUid(context.id, itemId),
                title: `Zamiana: ${myItemName} ↔ ${offeredName}`,
                occursOn,
                groupName,
                url: origin + context.path,
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
