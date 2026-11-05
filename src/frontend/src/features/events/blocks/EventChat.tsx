"use client";

import { useOpenAndNavigate } from "../../../hooks/useOpenAndNavigate";
import { EventChatRow } from "../components/EventChatRow";
import { useEventPage } from "../EventPageContext";

/** The event's chat, for the author and active attendees only. */
export function EventChat() {
  const { view } = useEventPage();
  const chat = useOpenAndNavigate();
  if (view.kind !== "author" && view.kind !== "attendee") return null;
  return (
    <EventChatRow
      onOpen={() => void chat.open({ kind: "EVENT", id: view.event.id })}
      busy={chat.busy}
      error={chat.error}
    />
  );
}
