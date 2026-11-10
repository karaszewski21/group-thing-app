import type { NeededItemResponse } from "../../../api/terms";
import { useOrganizedMeetings } from "../hooks/useOrganizedMeetings";
import { EventCard, OrganizerTermCard } from "../TermCards";
import { TermList } from "./TermList";

const NO_NEEDED_ITEMS: NeededItemResponse[] = [];

/** "Organizujesz": led group terms and own events on one list. */
export function OrganizedTab() {
  const { entries, paged, neededItems, loading, error } = useOrganizedMeetings();

  return (
    <TermList
      entries={entries}
      paged={paged}
      loading={loading}
      error={error}
      emptyText="Brak zaplanowanych spotkań."
      renderTerm={(entry) =>
        "starts_at" in entry ? (
          <EventCard event={entry} />
        ) : (
          <OrganizerTermCard term={entry} neededItems={neededItems.get(entry.id) ?? NO_NEEDED_ITEMS} />
        )
      }
    />
  );
}
