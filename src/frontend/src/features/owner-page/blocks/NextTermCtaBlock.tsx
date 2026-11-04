import { Link } from "../../../routing/navigation";
import dayjs from "../../../utils/dayjs";
import type { BlockProps, OrganizerPageData } from "../layouts/types";
import { organizerTermPath } from "../organizerHelpers";
import { DateTile } from "./DateTile";
import { nearestTerm } from "./nearestTerm";

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

// eslint-disable-next-line react-refresh/only-export-components -- the renderer reads each block's isEmpty next to it
export function isNextTermCtaEmpty(data: OrganizerPageData): boolean {
  return nearestTerm(data.directory) === null;
}

/** `card`: the nearest term on a primary-soft panel — date tile, group name,
 * full date, sign-up count — with a sign-up call to action. */
export function NextTermCtaBlock({ data }: BlockProps) {
  const term = nearestTerm(data.directory);
  if (!term) return null;

  return (
    <section className="px-6 pt-6">
      <div className="rounded-2xl bg-primary-soft p-4">
        <h2 className="text-[11px] font-extrabold tracking-wide text-primary-fg">NAJBLIŻSZE ZAJĘCIA</h2>
        <div className="mt-2 flex items-center gap-3">
          <DateTile occursOn={term.occurs_on} className="bg-paper text-ink" />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold text-ink">{term.group_name}</p>
            <p className="text-[12.5px] text-ink">{dayjs(term.occurs_on).format("dddd, D MMMM · HH:mm")}</p>
            <p className="text-[12.5px] text-ink-soft">zapisanych: {term.attendee_count}</p>
          </div>
        </div>
        <Link
          to={organizerTermPath(data.organization.slug, term.group_id, term.term_id)}
          className={`mt-3 flex min-h-11 items-center justify-center rounded-full bg-primary px-4 text-[14px] font-extrabold text-on-primary ${FOCUS_RING}`}
        >
          Zobacz i zapisz się →
        </Link>
      </div>
    </section>
  );
}
