"use client";

import { GroupHeader } from "../../terms/components/GroupHeader";
import { useEventPage } from "../EventPageContext";

/** The chip to the organization, else to the author's person profile, and the
 * event's name. */
export function EventHeader() {
  const { event } = useEventPage().view;
  return (
    <GroupHeader
      title={event.name}
      organizerName={event.author_display_name}
      organizerSlug={
        event.organization !== null
          ? event.author_slug
          : (event.participants.find((p) => p.is_author)?.party_id ?? null)
      }
    />
  );
}
