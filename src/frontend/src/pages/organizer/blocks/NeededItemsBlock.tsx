import { Check } from "lucide-react";
import { Link } from "react-router-dom";
import type { OrganizerPageResponse } from "../../../api/groups";
import { BringsIcon } from "../../../components/shared/Icons";
import dayjs from "../../../utils/dayjs";
import type { BlockProps, OrganizerPageData } from "../layouts/types";

// eslint-disable-next-line react-refresh/only-export-components -- the renderer reads each block's isEmpty next to it
export function isNeededItemsEmpty(data: OrganizerPageData): boolean {
  return (data.directory?.needed_items.length ?? 0) === 0;
}

/** Term dates known to the directory; needed items carry only a term id. */
function termDates(directory: OrganizerPageResponse): Map<string, string> {
  const dates = new Map<string, string>();
  for (const circle of directory.circles) {
    if (circle.next_term) dates.set(circle.next_term.id, circle.next_term.occurs_on);
  }
  for (const term of directory.upcoming_terms) dates.set(term.term_id, term.occurs_on);
  return dates;
}

/** `list`: what still has to be brought to the next terms. Read-only; a
 * claimed item says only that it is covered, never by whom. */
export function NeededItemsBlock({ data }: BlockProps) {
  const directory = data.directory;
  if (!directory) return null;
  const dates = termDates(directory);
  const slug = data.organization.slug;

  return (
    <section className="px-6 pt-6">
      <h2 className="mb-3 font-serif text-xl font-semibold text-ink">Potrzebne na najbliższe zajęcia</h2>
      <ul className="divide-y divide-line rounded-2xl border border-line bg-paper">
        {directory.needed_items.map((item) => {
          if (item.claimed) {
            return (
              <li key={item.id} className="flex min-h-[44px] items-center gap-3 px-4 py-2.5">
                <Check aria-hidden="true" className="h-5 w-5 shrink-0 text-primary-fg" />
                <span className="min-w-0 flex-1 text-[14px] text-ink-soft">{item.product_name}</span>
                <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-extrabold text-primary-fg">
                  Zapewnione
                </span>
              </li>
            );
          }
          const occursOn = dates.get(item.term_id);
          return (
            <li key={item.id} className="flex min-h-[44px] items-center gap-3 px-4 py-2.5">
              <BringsIcon aria-hidden="true" className="h-5 w-5 shrink-0 text-ink-soft" />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-bold text-ink">{item.product_name}</span>
                {occursOn && (
                  <span className="block text-[12px] text-ink-soft">{dayjs(occursOn).format("dd D MMM")}</span>
                )}
              </span>
              <Link
                to={`/${slug}/grupa/${item.group_id}/term/${item.term_id}`}
                aria-label={`Zobacz termin: ${item.product_name}`}
                className="flex min-h-[44px] shrink-0 items-center text-[13px] font-extrabold text-primary-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                Zobacz →
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
