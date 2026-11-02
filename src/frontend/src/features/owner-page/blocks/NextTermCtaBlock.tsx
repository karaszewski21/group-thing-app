import type { BlockProps, OrganizerPageData } from "../layouts/types";
import { organizerTermPath } from "../organizerHelpers";
import { NearestDateCard } from "./NearestDateCard";
import { nearestTerm } from "./nearestTerm";

// eslint-disable-next-line react-refresh/only-export-components -- the renderer reads each block's isEmpty next to it
export function isNextTermCtaEmpty(data: OrganizerPageData): boolean {
  return nearestTerm(data.directory) === null;
}

/** `card`: the nearest term with a sign-up call to action. */
export function NextTermCtaBlock({ data }: BlockProps) {
  const term = nearestTerm(data.directory);
  if (!term) return null;

  return (
    <section className="px-6 pt-6">
      <NearestDateCard
        variant="soft"
        kicker="NAJBLIŻSZE ZAJĘCIA"
        name={term.group_name}
        startsAt={term.occurs_on}
        details={`zapisanych: ${term.attendee_count}`}
        ctaHref={organizerTermPath(data.organization.slug, term.group_id, term.term_id)}
        ctaLabel="Zobacz i zapisz się →"
      />
    </section>
  );
}
