"use client";

import { ParticipantList } from "../../../components/shared/ParticipantList";
import { useEventPage } from "../EventPageContext";
import { buildEventParticipants, eventAttendeesEmptyCopy } from "../eventViewModel";

/** Who takes part; the empty list invites only a viewer who can sign up. */
export function EventAttendees() {
  const { view } = useEventPage();
  const { participants } = view.event;
  return (
    <ParticipantList
      label="Zapisani na wydarzenie"
      rows={buildEventParticipants(participants)}
      emptyMessage={eventAttendeesEmptyCopy(participants, view.kind === "visitor" && !view.ended)}
    />
  );
}
