import type { EventSearchResult, TermSearchResult } from "../../api/search";
import { Link } from "../../routing/navigation";
import dayjs from "../../utils/dayjs";
import { ResultKindLabel } from "./ResultKindLabel";

export const RESULT_ROW_CLASS =
  "flex items-start gap-3.5 rounded-[22px] border border-line bg-paper p-3.5 text-left outline-none transition-colors hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring md:gap-4 md:p-4";

function joinParts(parts: (string | null)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(" · ");
}

/** A term or an event in the search list: a calendar leaf (weekday, day,
 * month), what it is, the title, and who · when · where. The leaf is
 * decorative, so the date is read out from a hidden line. */
export function MeetingResultTile({ result }: { result: TermSearchResult | EventSearchResult }) {
  const startsAt = dayjs(result.meta.starts_at);
  const isTerm = result.kind === "term";

  return (
    <Link to={result.href} className={RESULT_ROW_CLASS}>
      <span
        aria-hidden="true"
        className="flex h-16 w-14 flex-none flex-col items-center justify-center rounded-2xl bg-primary text-on-primary md:h-17 md:w-16"
      >
        <span className="text-[11px] font-extrabold uppercase">{startsAt.format("ddd")}</span>
        <span className="font-serif text-[24px] leading-none font-extrabold md:text-[26px]">{startsAt.format("D")}</span>
        <span className="text-[11px] font-semibold">{startsAt.format("MMM")}</span>
      </span>
      <span className="min-w-0 flex-1">
        <ResultKindLabel
          label={isTerm ? "Termin" : "Wydarzenie"}
          mine={isTerm && result.meta.in_my_groups}
          points={isTerm ? result.meta.attendance_points : 0}
        />{" "}
        <span className="mt-0.5 block text-[16px] leading-snug font-extrabold text-ink md:text-[17px]">{result.title}</span>{" "}
        <span className="sr-only">{startsAt.format("dddd D MMMM")}</span>{" "}
        <span className="mt-0.5 block text-[13px] text-ink-soft md:text-sm">
          {joinParts([result.subtitle, startsAt.format("HH:mm"), result.meta.place])}
        </span>
      </span>
    </Link>
  );
}
