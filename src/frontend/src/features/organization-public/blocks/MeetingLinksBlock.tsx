import { Link } from "../../../routing/navigation";
import dayjs from "../../../utils/dayjs";
import { termLinksOf } from "../layouts/layoutData";
import type { BlockProps, OrganizerPageData } from "../layouts/types";

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

// eslint-disable-next-line react-refresh/only-export-components -- the renderer reads each block's isEmpty next to it
export function isMeetingLinksEmpty(data: OrganizerPageData): boolean {
  return termLinksOf(data.directory).length === 0;
}

/** The owner's nearest meetings as date-only chips ("zajęcia" or
 * "wydarzenie" plus the day and hour), each linking to its page, with a link
 * to all meetings. For a layout where items lead and dates are secondary. */
export function MeetingLinksBlock({ data }: BlockProps) {
  const links = termLinksOf(data.directory);
  if (links.length === 0) return null;

  return (
    <section className="px-6 pt-6">
      <h2 className="mb-3 font-serif text-lg font-semibold text-ink">Najbliższe spotkania</h2>
      <ul className="flex flex-wrap gap-2">
        {links.map((link) => (
          <li key={link.path}>
            <Link
              to={link.path}
              className={`flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-paper px-4 text-[13px] text-ink ${FOCUS_RING}`}
            >
              <span className="text-ink-soft">{link.kind === "EVENT" ? "Wydarzenie" : "Zajęcia"}</span>{" "}
              <span className="font-bold">{dayjs(link.starts_at).format("dd D MMM, HH:mm")}</span>
              <span aria-hidden="true">›</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link
        to={`/${data.organization.slug}/meetings`}
        className={`mt-1 flex min-h-[44px] items-center justify-center text-[13px] font-bold text-primary-fg ${FOCUS_RING}`}
      >
        Wszystkie spotkania →
      </Link>
    </section>
  );
}
