"use client";

import { ParticipantList } from "../../../components/shared/ParticipantList";
import { attendeeElementId } from "../components/termSectionTypes";
import { buildAttendees } from "../termViewModel";
import { useTermPage } from "../TermPageContext";

/** Everyone taking part, with their listed items; entries are scroll targets
 * for the group visualization, which highlights the picked one. Nothing
 * without a term. */
export function TermAttendees() {
  const { view, activePartyId } = useTermPage();
  if (!view.group.term) return null;
  const attendees = buildAttendees(view.group);
  return (
    <ParticipantList
      label="Zapisani na spotkanie"
      rows={attendees}
      activePartyId={activePartyId}
      rowId={attendeeElementId}
      emptyMessage={attendees.length === 0 && "Tu zobaczysz rodziny i rzeczy, które przyniosą do wymiany."}
    />
  );
}
