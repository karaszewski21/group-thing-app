"use client";

import { useId } from "react";
import type { GroupTerm } from "../../../api/organizations";
import { Link } from "../../../routing/navigation";
import dayjs from "../../../utils/dayjs";
import { pluralPl } from "../../../utils/plural";
import { DateTile } from "../../organization-public/blocks/DateTile";
import { useGroupTermsPage } from "../GroupTermsContext";

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** One term as a card on `/:slug/meetings`: the date tile, the day and
 * hour, the description, the place and the sign-up count, linking to the
 * term page. */
function TermCard({ term }: { term: GroupTerm }) {
  const attendees = `${term.attendee_count} ${pluralPl(term.attendee_count, "zapisany", "zapisanych", "zapisanych")}`;
  return (
    <Link
      to={term.path}
      className={`flex items-center gap-3 rounded-3xl border border-line bg-paper p-3 no-underline ${FOCUS_RING}`}
    >
      <DateTile occursOn={term.occurs_on} className="bg-primary text-on-primary" weekday />
      <span className="flex min-w-0 flex-col">
        <span className="text-[15px] font-bold text-ink">{dayjs(term.occurs_on).format("dddd, D MMMM · HH:mm")}</span>
        {term.description && <span className="truncate text-[13px] text-ink">{term.description}</span>}
        <span className="text-[12.5px] text-ink-soft">
          {term.location_name ? `${term.location_name} · ${attendees}` : attendees}
        </span>
      </span>
    </Link>
  );
}

/** The group's upcoming terms, earliest first, or the empty notice, then a
 * link to every meeting of the Organization. */
export function GroupTermsList() {
  const headingId = useId();
  const { owner, group, terms } = useGroupTermsPage();

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 px-6 pt-6">
      <h2 id={headingId} className="font-serif text-lg font-semibold text-ink">
        Terminy grupy
      </h2>
      {terms.length === 0 ? (
        <div className="rounded-3xl border border-line bg-paper p-4">
          <p className="text-[14px] font-bold text-ink">{group.name} nie ma teraz zaplanowanych terminów</p>
        </div>
      ) : (
        <>
          <p className="text-[13px] text-ink-soft">
            {terms.length}{" "}
            {pluralPl(terms.length, "zaplanowany termin", "zaplanowane terminy", "zaplanowanych terminów")}
          </p>
          <ul className="flex flex-col gap-2.5">
            {terms.map((term) => (
              <li key={term.id}>
                <TermCard term={term} />
              </li>
            ))}
          </ul>
        </>
      )}
      <Link
        to={`/${owner.slug ?? owner.party_id}/meetings`}
        className={`flex min-h-[44px] items-center justify-center text-[13px] font-bold text-primary-fg ${FOCUS_RING}`}
      >
        Wszystkie spotkania →
      </Link>
    </section>
  );
}
