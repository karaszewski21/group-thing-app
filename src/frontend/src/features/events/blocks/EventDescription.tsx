"use client";

import { FIELD_LABEL, ITEM_SECTION } from "../../product/itemPageShared";
import { useEventPage } from "../EventPageContext";

/** The event's description, styled like the item page's; nothing without one. */
export function EventDescription() {
  const { description } = useEventPage().view.event;
  if (!description) return null;
  return (
    <section className={`mx-5 ${ITEM_SECTION}`} aria-labelledby="event-description-heading">
      <h2 id="event-description-heading" className={FIELD_LABEL}>
        Opis
      </h2>
      <p className="mt-1.5 whitespace-pre-line wrap-break-word text-[13.5px] text-ink">{description}</p>
    </section>
  );
}
