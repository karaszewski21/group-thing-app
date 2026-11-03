import { Link, useAppParams } from "../../../routing/navigation";
import { ModalSheet } from "../../../components/shared/ModalSheet";
import { BTN_LG, BTN_PRIMARY } from "../../../components/shared/uiStyles";
import { AddToCalendarButton } from "../../../components/shared/AddToCalendarButton";
import { useOrigin } from "../../../lib/useClientValue";
import { calendarUid } from "../../../utils/calendar";
import dayjs from "../../../utils/dayjs";
import type { TakeTarget } from "./useItemTake";
import { itemPagePath } from "./useItemRoutes";

/** "Wzięte!" sheet after a successful take: for a term or event `target`
 * when and where to pick the item up and a calendar export linking to the
 * context's page; for a personal pickup only the chat hint. Both link to
 * the item page. */
export function TakeSuccessSheet({
  itemId,
  itemName,
  target,
  onClose,
}: {
  itemId: string;
  itemName: string;
  target: TakeTarget;
  onClose: () => void;
}) {
  const origin = useOrigin();
  const { slug = "" } = useAppParams();
  const context = target.kind === "PERSONAL" ? null : target;
  const sentence = context
    ? `Odbierz „${itemName}” w ${dayjs(context.starts_at).format("ddd DD.MM [o] HH:mm")} — ${context.name}`
    : `Zarezerwowano „${itemName}” — odbiór osobisty`;
  const reminder =
    context === null
      ? "Dokładny adres i godzinę ustalicie z właścicielem na czacie."
      : context.kind === "EVENT"
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
        {context && (
          <div className="min-[520px]:flex-1">
            <AddToCalendarButton
              size="lg"
              direction="up"
              event={{
                uid: calendarUid(context.id, itemId),
                title: `Odbiór: ${itemName}`,
                occursOn: context.starts_at,
                groupName: context.name,
                url: origin + context.path,
              }}
            />
          </div>
        )}
        <Link
          to={itemPagePath(slug, itemId)}
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
