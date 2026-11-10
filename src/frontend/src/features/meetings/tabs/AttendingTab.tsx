import type { NeededItemResponse } from "../../../api/terms";
import { useAttendingMeetings } from "../hooks/useAttendingMeetings";
import { EventCard, SavedTermCard } from "../TermCards";
import { TermList } from "./TermList";

const NO_NEEDED_ITEMS: NeededItemResponse[] = [];

/** "Biorę udział": attended events, RSVPed terms and private circles' terms on one list. */
export function AttendingTab() {
  const { entries, paged, neededItems, pledgesOf, withdrawPledge, loading, error } = useAttendingMeetings();

  return (
    <TermList
      entries={entries}
      paged={paged}
      loading={loading}
      error={error}
      emptyText="Nie masz jeszcze żadnych zapisów."
      renderTerm={(entry) =>
        "termId" in entry ? (
          <SavedTermCard
            card={entry}
            neededItems={neededItems.get(entry.termId) ?? NO_NEEDED_ITEMS}
            pledges={pledgesOf(entry.termId)}
            onWithdrawPledge={(pledgeId) => void withdrawPledge(pledgeId)}
          />
        ) : (
          <EventCard event={entry} editable={false} />
        )
      }
    />
  );
}
