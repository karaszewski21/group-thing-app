"use client";

import { AttendeeList } from "../components/AttendeeList";
import { buildAttendees } from "../termViewModel";
import { useTermPage } from "../TermPageContext";

/** Everyone taking part, with their listed items; nothing without a term. */
export function TermAttendees() {
  const { view, activePartyId } = useTermPage();
  if (!view.group.term) return null;
  return <AttendeeList attendees={buildAttendees(view.group)} activePartyId={activePartyId} />;
}
