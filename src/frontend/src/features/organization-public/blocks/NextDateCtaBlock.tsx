import { Link } from "../../../routing/navigation";
import dayjs from "../../../utils/dayjs";
import { upcomingTermsOf } from "../layouts/layoutData";
import type { BlockProps, OrganizerPageData } from "../layouts/types";
import { DateTile } from "./DateTile";

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

// eslint-disable-next-line react-refresh/only-export-components -- the renderer reads each block's isEmpty next to it
export function isNextDateCtaEmpty(data: OrganizerPageData): boolean {
  return upcomingTermsOf(data.directory).length === 0;
}

/** `card`: the owner's nearest term or event on a primary-soft panel — date
 * tile, name, full date, place and sign-up count — with a sign-up call to action. */
export function NextDateCtaBlock({ data }: BlockProps) {
  const [date] = upcomingTermsOf(data.directory);
  if (!date) return null;
  const isEvent = date.kind === "EVENT";

  return (
    <section className="px-6 pt-6">
      <div className="rounded-2xl bg-primary-soft p-4">
        <h2 className="text-[11px] font-extrabold tracking-wide text-primary-fg">
          {isEvent ? "NAJBLIŻSZE WYDARZENIE" : "NAJBLIŻSZE ZAJĘCIA"}
        </h2>
        <div className="mt-2 flex items-center gap-3">
          <DateTile occursOn={date.starts_at} className="bg-paper text-ink" />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold text-ink">{date.name}</p>
            <p className="text-[12.5px] text-ink">{dayjs(date.starts_at).format("dddd, D MMMM · HH:mm")}</p>
            {date.location_name && <p className="truncate text-[12.5px] text-ink">{date.location_name}</p>}
            <p className="text-[12.5px] text-ink-soft">zapisanych: {date.attendee_count}</p>
          </div>
        </div>
        <Link
          to={date.path}
          className={`mt-3 flex min-h-11 items-center justify-center rounded-full bg-primary px-4 text-[14px] font-extrabold text-on-primary ${FOCUS_RING}`}
        >
          Zobacz i zapisz się →
        </Link>
      </div>
    </section>
  );
}
