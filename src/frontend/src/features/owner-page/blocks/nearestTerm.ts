import type { OrganizerPageResponse, OrganizerTerm } from "../../../api/groups";

/** The organizer's next term. The 60-day window comes first; when it is
 * empty, the earliest circle `next_term` (which has no window) stands in, so
 * a term further away is still shown rather than "no terms". */
export function nearestTerm(directory: OrganizerPageResponse | null): OrganizerTerm | null {
  if (!directory) return null;
  if (directory.upcoming_terms.length > 0) return directory.upcoming_terms[0];

  let nearest: OrganizerTerm | null = null;
  for (const circle of directory.circles) {
    const next = circle.next_term;
    if (!next) continue;
    // Naive ISO datetimes of one format compare correctly as strings.
    const earlier =
      nearest === null ||
      next.occurs_on < nearest.occurs_on ||
      (next.occurs_on === nearest.occurs_on && circle.id < nearest.group_id);
    if (earlier) {
      nearest = {
        term_id: next.id,
        group_id: circle.id,
        group_name: circle.name,
        occurs_on: next.occurs_on,
        description: null,
        attendee_count: next.attendee_count,
      };
    }
  }
  return nearest;
}
