import { Link } from "react-router-dom";
import dayjs from "../../../utils/dayjs";
import type { BlockProps, OrganizerPageData } from "../layouts/types";
import { organizerTermPath } from "../organizerHelpers";
import { nearestTerm } from "./nearestTerm";

const COMPACT_LIMIT = 3;
const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** The TermPreviewCard date tile: day number over the short month. */
export function DateTile({ occursOn, className = "bg-primary-soft" }: { occursOn: string; className?: string }) {
  const date = dayjs(occursOn);
  return (
    <div
      aria-hidden="true"
      className={`flex h-[46px] w-[46px] shrink-0 flex-col items-center justify-center rounded-[13px] text-ink ${className}`}
    >
      <span className="text-base font-extrabold leading-none">{date.format("D")}</span>
      <span className="text-[10.5px] font-bold">{date.format("MMM")}</span>
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- the renderer reads each block's isEmpty next to it
export function isUpcomingTermsEmpty(data: OrganizerPageData): boolean {
  return nearestTerm(data.directory) === null;
}

/** `list` (default): date-tile rows linking to each term, plus a link to the
 * full agenda. `compact`: up to three date chips. An empty 60-day window
 * falls back to the nearest term beyond it. */
export function UpcomingTermsBlock({ data, variant }: BlockProps) {
  const directory = data.directory;
  const nearest = nearestTerm(directory);
  if (!directory || !nearest) return null;
  const slug = data.organization.slug;
  const windowEmpty = directory.upcoming_terms.length === 0;
  const terms = windowEmpty ? [nearest] : directory.upcoming_terms;

  if (variant === "compact") {
    return (
      <section className="px-6 pt-6">
        <h2 className="mb-3 font-serif text-lg font-semibold text-ink">Najbliższe spotkania</h2>
        <ul className="flex gap-2 overflow-x-auto pb-1">
          {terms.slice(0, COMPACT_LIMIT).map((term) => (
            <li key={term.term_id} className="shrink-0">
              <Link
                to={organizerTermPath(slug, term.group_id, term.term_id)}
                className={`flex min-h-[44px] items-center whitespace-nowrap rounded-full border border-line bg-paper px-4 text-[13px] font-bold text-ink ${FOCUS_RING}`}
              >
                {dayjs(term.occurs_on).format("dd D MMM")}
                <span aria-hidden="true">&nbsp;›</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const total = directory.stats.upcoming_term_count;
  const allTermsLabel = windowEmpty
    ? "Wszystkie terminy →"
    : total > directory.upcoming_terms.length
      ? `Wszystkie terminy (${total}) →`
      : null;

  return (
    <section className="px-6 pt-6">
      <h2 className="mb-3 font-serif text-lg font-semibold text-ink">Najbliższe terminy</h2>
      <ul className="divide-y divide-line rounded-2xl border border-line bg-paper">
        {terms.map((term) => {
          const date = dayjs(term.occurs_on);
          const meta = [date.format("dd"), date.format("HH:mm")];
          if (term.attendee_count > 0) meta.push(`zapisanych: ${term.attendee_count}`);
          return (
            <li key={term.term_id}>
              <Link
                to={organizerTermPath(slug, term.group_id, term.term_id)}
                className={`flex min-h-14 items-center gap-3 rounded-2xl px-3 py-2.5 ${FOCUS_RING}`}
              >
                <DateTile occursOn={term.occurs_on} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-bold text-ink">{term.group_name}</p>
                  <p className="text-[12px] text-ink-soft">{meta.join(" · ")}</p>
                </div>
                <span aria-hidden="true" className="text-ink-soft">
                  ›
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {allTermsLabel && (
        <Link
          to={`/${slug}/terminy`}
          className={`mt-1 flex min-h-[44px] items-center justify-center text-[13px] font-bold text-primary-fg ${FOCUS_RING}`}
        >
          {allTermsLabel}
        </Link>
      )}
    </section>
  );
}
