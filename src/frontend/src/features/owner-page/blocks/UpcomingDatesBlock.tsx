import type { OwnerNearestDate } from "../../../api/ownerItems";
import { Link } from "../../../routing/navigation";
import dayjs from "../../../utils/dayjs";
import type { BlockProps, OrganizerPageData } from "../layouts/types";
import { DateTile } from "./DateTile";

const COMPACT_LIMIT = 3;
const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

// eslint-disable-next-line react-refresh/only-export-components -- the renderer reads each block's isEmpty next to it
export function isUpcomingDatesEmpty(data: OrganizerPageData): boolean {
  return (data.directory?.upcoming_dates.length ?? 0) === 0;
}

function dateMeta(date: OwnerNearestDate): string {
  const meta = [date.kind === "EVENT" ? "Wydarzenie" : "Termin", dayjs(date.starts_at).format("dd HH:mm")];
  if (date.location_name) meta.push(date.location_name);
  if (date.attendee_count > 0) meta.push(`zapisanych: ${date.attendee_count}`);
  return meta.join(" · ");
}

/** The owner's upcoming terms and events, earliest first, each linking to its
 * page. `list` (default): date-tile rows with a link to all meetings.
 * `after-next`: the same rows without the first date, for a layout that
 * features it in `next-date-cta`. `compact`: up to three date chips. */
export function UpcomingDatesBlock({ data, variant }: BlockProps) {
  const all = data.directory?.upcoming_dates ?? [];
  const dates = variant === "after-next" ? all.slice(1) : all;
  if (dates.length === 0) return null;
  const meetingsLink = (
    <Link
      to={`/${data.organization.slug}/meetings`}
      className={`mt-1 flex min-h-[44px] items-center justify-center text-[13px] font-bold text-primary-fg ${FOCUS_RING}`}
    >
      Wszystkie spotkania →
    </Link>
  );

  if (variant === "compact") {
    return (
      <section className="px-6 pt-6">
        <h2 className="mb-3 font-serif text-lg font-semibold text-ink">Najbliższe spotkania</h2>
        <ul className="flex gap-2 overflow-x-auto pb-1">
          {dates.slice(0, COMPACT_LIMIT).map((date) => (
            <li key={`${date.kind}-${date.id}`} className="shrink-0">
              <Link
                to={date.path}
                className={`flex min-h-[44px] items-center whitespace-nowrap rounded-full border border-line bg-paper px-4 text-[13px] font-bold text-ink ${FOCUS_RING}`}
              >
                {dayjs(date.starts_at).format("dd D MMM")}
                <span aria-hidden="true">&nbsp;›</span>
              </Link>
            </li>
          ))}
        </ul>
        {meetingsLink}
      </section>
    );
  }

  return (
    <section className="px-6 pt-6">
      <h2 className="mb-3 font-serif text-lg font-semibold text-ink">
        {variant === "after-next" ? "Kolejne spotkania" : "Najbliższe spotkania"}
      </h2>
      <ul className="divide-y divide-line rounded-2xl border border-line bg-paper">
        {dates.map((date) => (
          <li key={`${date.kind}-${date.id}`}>
            <Link to={date.path} className={`flex min-h-14 items-center gap-3 rounded-2xl px-3 py-2.5 ${FOCUS_RING}`}>
              <DateTile occursOn={date.starts_at} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-bold text-ink">{date.name}</p>
                <p className="truncate text-[12px] text-ink-soft">{dateMeta(date)}</p>
              </div>
              <span aria-hidden="true" className="text-ink-soft">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {meetingsLink}
    </section>
  );
}
