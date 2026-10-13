import { Link } from "react-router-dom";
import { ModalSheet } from "../../components/krag/ModalSheet";
import { BTN_LG, BTN_PRIMARY } from "../../components/krag/kragStyles";
import { AddToCalendarButton } from "../../components/shared/AddToCalendarButton";
import { calendarUid } from "../../utils/calendar";
import dayjs from "../../utils/dayjs";
import { organizerTermPath } from "../organizer/organizerHelpers";

/** "Wzięte!" sheet after a successful take on the term page: when and where
 * to pick the item up, a calendar export and a link to the item page. */
export function TakeSuccessSheet({
  itemId,
  itemName,
  occursOn,
  groupName,
  groupId,
  termId,
  organizerSlug,
  onClose,
}: {
  itemId: string;
  itemName: string;
  occursOn: string;
  groupName: string;
  groupId: string;
  termId: string;
  organizerSlug: string;
  onClose: () => void;
}) {
  const when = dayjs(occursOn).format("ddd DD.MM [o] HH:mm");
  const sentence = `Odbierz „${itemName}” w ${when} — ${groupName}`;

  return (
    <ModalSheet title="Wzięte!" ariaLabel={sentence} onClose={onClose}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-primary-soft font-extrabold text-primary-fg"
        >
          ✓
        </span>
        <p className="text-[15px] font-extrabold text-ink">{sentence}</p>
      </div>
      <p className="mt-3 text-sm text-ink-soft">
        Rzecz czeka na Ciebie na tym terminie. Dodaj go do kalendarza, żeby nie zapomnieć.
      </p>

      <div className="mt-5 flex flex-col gap-2 min-[520px]:flex-row min-[520px]:flex-wrap">
        <div className="min-[520px]:flex-1">
          <AddToCalendarButton
            size="lg"
            direction="up"
            event={{
              uid: calendarUid(termId, itemId),
              title: `Odbiór: ${itemName}`,
              occursOn,
              groupName,
              url: window.location.origin + organizerTermPath(organizerSlug, groupId, termId),
            }}
          />
        </div>
        <Link
          to={`/product/${itemId}`}
          className={`${BTN_PRIMARY} ${BTN_LG} inline-flex items-center justify-center no-underline min-[520px]:flex-1`}
        >
          Zobacz rzecz
        </Link>
        <button
          type="button"
          onClick={onClose}
          className="py-2 text-[13px] font-bold text-ink-soft min-[520px]:hidden"
        >
          Zamknij
        </button>
      </div>
    </ModalSheet>
  );
}
