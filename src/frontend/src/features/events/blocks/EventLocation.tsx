"use client";

import { PlaceDetails } from "../../../components/shared/PlaceCard";
import { FIELD_LABEL, ITEM_SECTION } from "../../product/itemPageShared";
import { useEventPage } from "../EventPageContext";

/** Where the event takes place, framed like the item page's location; nothing
 * without a place. */
export function EventLocation() {
  const { location } = useEventPage().view.event;
  if (!location) return null;
  return (
    <section className={`mx-5 ${ITEM_SECTION}`} aria-labelledby="event-location-heading">
      <h2 id="event-location-heading" className={FIELD_LABEL}>
        Miejsce
      </h2>
      <PlaceDetails location={location} />
    </section>
  );
}
