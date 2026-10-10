import { Link } from "react-router-dom";
import type { OrganizerTerm } from "../../../api/groups";
import dayjs from "../../../utils/dayjs";
import { organizerTermPath } from "../organizerHelpers";

interface AgendaDay {
  key: string;
  label: string;
  terms: OrganizerTerm[];
}

/** Consecutive terms of one calendar day; the input is already ordered by date. */
function groupByDay(terms: OrganizerTerm[]): AgendaDay[] {
  const days: AgendaDay[] = [];
  for (const term of terms) {
    const date = dayjs(term.occurs_on);
    const key = date.format("YYYY-MM-DD");
    const last = days[days.length - 1];
    if (last?.key === key) last.terms.push(term);
    else days.push({ key, label: date.format("dddd, D MMMM"), terms: [term] });
  }
  return days;
}

interface AgendaListProps {
  slug: string;
  terms: OrganizerTerm[];
  /** One level below the heading the list sits under. */
  dayHeadingLevel: 2 | 3;
}

/** Terms grouped under day headers, each row one link to the term page.
 * Shared by the agenda block and the `/:slug/terminy` page. */
export function AgendaList({ slug, terms, dayHeadingLevel }: AgendaListProps) {
  const DayHeading = dayHeadingLevel === 2 ? "h2" : "h3";
  return (
    <div className="flex flex-col gap-4">
      {groupByDay(terms).map((day) => (
        <section key={day.key}>
          <DayHeading className="sticky top-0 z-[1] bg-cream py-1.5 text-[12px] font-extrabold uppercase tracking-wide text-ink-soft">
            {day.label}
          </DayHeading>
          <ol className="mt-1 divide-y divide-line rounded-2xl border border-line bg-paper">
            {day.terms.map((term) => {
              const date = dayjs(term.occurs_on);
              const time = date.format("HH:mm");
              const counted = term.attendee_count > 0;
              return (
                <li key={term.term_id}>
                  <Link
                    to={organizerTermPath(slug, term.group_id, term.term_id)}
                    className="flex min-h-[52px] items-center gap-3 rounded-2xl px-4 py-2.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                  >
                    <span className="w-12 shrink-0 text-[14px] font-extrabold text-ink">{time}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-bold text-ink">{term.group_name}</span>
                      {term.description && (
                        <span className="block truncate text-[12px] text-ink-soft">{term.description}</span>
                      )}
                    </span>
                    {counted && (
                      <span className="shrink-0 text-[12px] text-ink-soft">zapisanych {term.attendee_count}</span>
                    )}
                    <span aria-hidden="true" className="text-ink-soft">
                      ›
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
