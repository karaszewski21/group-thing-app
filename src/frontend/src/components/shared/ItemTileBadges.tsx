import { Fragment } from "react";
import type { ExchangeMode, ReservedByResponse } from "../../api/groups";
import { EXCHANGE_MODE_TONE, INTENT_LABELS } from "../../features/terms/components/termLabels";

const PILL_SIZE = {
  sm: "px-2 py-0.5 text-[11px]",
  md: "px-2.5 py-1 text-xs",
} as const;

/** A POINTS price as seen „60 pkt” and read „Za punkty: 60 pkt”. */
export function PointsPriceLabel({ price }: { price: number }) {
  return (
    <>
      <span className="sr-only">Za punkty:</span>
      {" "}
      {price} pkt
    </>
  );
}

function reservedLabel({ by_name, by_me }: ReservedByResponse): string {
  if (by_me) return "Zarezerwowana · przez Ciebie";
  return by_name ? `Zarezerwowana · przez ${by_name}` : "Zarezerwowana";
}

/** An item's text pills: the owner's intent per offered mode ("Chcę oddać" /
 * "Chcę się zamienić" / "Za punkty", or the `pointsPrice` as „N pkt” when
 * the server sends one) in its exchange-mode tone, then, while reserved, a
 * teal "Zarezerwowana" pill naming the reserver when the server sends one.
 * A `reservedCaption` marks the item reserved and replaces that text.
 * `md` is the product page header size. */
export function ItemTileBadges({
  modes,
  reservation = null,
  reservedCaption,
  pointsPrice = null,
  size = "sm",
}: {
  modes: readonly ExchangeMode[];
  reservation?: ReservedByResponse | null;
  /** A POINTS listing's price; `null` (term listings) shows „Za punkty”. */
  pointsPrice?: number | null;
  reservedCaption?: string;
  size?: keyof typeof PILL_SIZE;
}) {
  const reservedText = reservedCaption ?? (reservation ? reservedLabel(reservation) : null);
  if (modes.length === 0 && reservedText === null) return null;
  const pill = `rounded-full font-extrabold ${PILL_SIZE[size]}`;
  return (
    <span className="flex flex-wrap gap-1">
      {modes.map((mode, index) => (
        <Fragment key={mode}>
          {index > 0 && " "}
          <span className={`${pill} ${EXCHANGE_MODE_TONE[mode]}`}>
            {mode === "POINTS" && pointsPrice !== null ? <PointsPriceLabel price={pointsPrice} /> : INTENT_LABELS[mode]}
          </span>
        </Fragment>
      ))}
      {reservedText !== null && (
        <>
          {modes.length > 0 && " "}
          <span className={`${pill} bg-teal-soft text-ink`}>{reservedText}</span>
        </>
      )}
    </span>
  );
}
