import type { PointHistoryEntry } from "../../api/points";
import dayjs from "../../utils/dayjs";
import { POINTS_ICON, pointsAmount, pointsSubtitle, pointsTitle } from "./pointsLabels";

const AMOUNT_TONE = { plus: "text-mint", minus: "text-danger", neutral: "text-ink-soft" } as const;

/** One history entry: icon, title, „{date} · {subtitle}” with the optional
 * reputation pill, and the amount (`pointsAmount`). `occurred_at` is naive UTC. */
export function PointsHistoryRow({ entry }: { entry: PointHistoryEntry }) {
  const subtitle = pointsSubtitle(entry);
  const amount = pointsAmount(entry);
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-line bg-cream px-[15px] py-3.5">
      <span aria-hidden="true" className="text-xl">
        {POINTS_ICON[entry.type]}
      </span>
      <div className="min-w-0 flex-1">
        <b className="block text-sm wrap-break-word text-ink">{pointsTitle(entry)}</b>{" "}
        <span className="block text-[12.5px] text-ink-soft">
          {dayjs.utc(entry.occurred_at).local().format("D MMM")}
          {subtitle !== null && ` · ${subtitle}`}
          {entry.reputation > 0 && (
            <>
              {" · "}
              <span className="inline-block rounded-full bg-lime-soft px-2.5 py-0.5 text-[10.5px] font-extrabold text-accent-fg">
                +{entry.reputation} reputacji
              </span>
            </>
          )}
        </span>
      </div>
      <b className={`max-w-[45%] text-right ${AMOUNT_TONE[amount.tone]}`}>{amount.text}</b>
    </li>
  );
}
