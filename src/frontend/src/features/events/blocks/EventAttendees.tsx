"use client";

import { EventAttendeeList } from "../components/EventAttendeeList";
import { useEventPage } from "../EventPageContext";

/** Who takes part; the empty list invites only a viewer who can sign up. */
export function EventAttendees() {
  const { view } = useEventPage();
  return (
    <EventAttendeeList
      participants={view.event.participants}
      canSignUp={view.kind === "visitor" && !view.ended}
    />
  );
}
