"use client";

import { useEventPage } from "../EventPageContext";

/** The event's banner; nothing without one. */
export function EventBanner() {
  const { event } = useEventPage().view;
  if (!event.banner_url) return null;
  return (
    <img
      src={event.banner_url}
      alt={`Baner wydarzenia ${event.name}`}
      className="mx-5 block aspect-16/7 w-[calc(100%-2.5rem)] rounded-[22px] object-cover"
    />
  );
}
