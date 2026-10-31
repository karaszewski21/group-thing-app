import { Link } from "react-router-dom";
import { ModalSheet } from "../../../components/shared/ModalSheet";
import { BTN_LG, BTN_PRIMARY } from "../../../components/shared/uiStyles";
import { AddToCalendarButton } from "../../../components/shared/AddToCalendarButton";
import { calendarUid } from "../../../utils/calendar";
import dayjs from "../../../utils/dayjs";
import type { TakeContext } from "../hooks/useItemTake";

/** "Wzięte!" sheet after a successful take in a term or event `context`:
 * when and where to pick the item up, a calendar export linking to the
 * context's page and a link to the item page. */
export function TakeSuccessSheet({
  itemId,
  itemName,
  context,
  onClose,
}: {
  itemId: string;
  itemName: string;
  context: TakeContext;
  onClose: () => void;
}) {
  const when = dayjs(context.starts_at).format("ddd DD.MM [o] HH:mm");
  const sentence = `Odbierz „${itemName}” w ${when} — ${context.name}`;
  const reminder =
    context.kind === "event"
      ? "Rzecz czeka na Ciebie na tym wydarzeniu. Dodaj je do kalendarza, żeby nie zapomnieć."
      : "Rzecz czeka na Ciebie na tym terminie. Dodaj go do kalendarza, żeby nie zapomnieć.";

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
      <p className="mt-3 text-sm text-ink-soft">{reminder}</p>

      <div className="mt-5 flex flex-col gap-2 min-[520px]:flex-row min-[520px]:flex-wrap">
        <div className="min-[520px]:flex-1">
          <AddToCalendarButton
            size="lg"
            direction="up"
            event={{
              uid: calendarUid(context.id, itemId),
              title: `Odbiór: ${itemName}`,
              occursOn: context.starts_at,
              groupName: context.name,
              url: window.location.origin + context.path,
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
