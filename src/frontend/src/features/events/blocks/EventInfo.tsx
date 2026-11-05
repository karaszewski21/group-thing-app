"use client";

import { useOrigin } from "../../../lib/useClientValue";
import { eventPath } from "../../../routing/paths";
import { EventWhenCard } from "../components/EventWhenCard";
import { useEventPage } from "../EventPageContext";

/** When the event takes place, with the calendar and copy-link actions. */
export function EventInfo() {
  const { view, showToast } = useEventPage();
  const origin = useOrigin();
  const { event } = view;
  return (
    <EventWhenCard
      event={event}
      url={`${origin}${eventPath(event.author_slug, event.id)}`}
      onCopyLink={() => showToast("Skopiowano link")}
    />
  );
}
