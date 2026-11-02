import { Fragment } from "react";
import type { ExchangeMode, ReservedByResponse } from "../../api/groups";
import { EXCHANGE_MODE_TONE, INTENT_LABELS } from "../../pages/term/components/termLabels";

const PILL_SIZE = {
  sm: "px-2 py-0.5 text-[11px]",
  md: "px-2.5 py-1 text-xs",
} as const;

function reservedLabel({ by_name, by_me }: ReservedByResponse): string {
  if (by_me) return "Zarezerwowana · przez Ciebie";
  return by_name ? `Zarezerwowana · przez ${by_name}` : "Zarezerwowana";
}

/** An item's text pills: the owner's intent per offered mode ("Chcę oddać" /
 * "Chcę się zamienić") in its exchange-mode tone, then, while reserved, a
 * teal "Zarezerwowana" pill naming the reserver when the server sends one.
 * `md` is the product page header size. */
export function ItemTileBadges({
  modes,
  reservation = null,
  size = "sm",
}: {
  modes: readonly ExchangeMode[];
  reservation?: ReservedByResponse | null;
  size?: keyof typeof PILL_SIZE;
}) {
  if (modes.length === 0 && reservation === null) return null;
  const pill = `rounded-full font-extrabold ${PILL_SIZE[size]}`;
  return (
    <span className="flex flex-wrap gap-1">
      {modes.map((mode, index) => (
        <Fragment key={mode}>
          {index > 0 && " "}
          <span className={`${pill} ${EXCHANGE_MODE_TONE[mode]}`}>{INTENT_LABELS[mode]}</span>
        </Fragment>
      ))}
      {reservation && (
        <>
          {modes.length > 0 && " "}
          <span className={`${pill} bg-teal-soft text-ink`}>{reservedLabel(reservation)}</span>
        </>
      )}
    </span>
  );
}
