"use client";

import { PlaceDetails } from "../../../components/shared/PlaceCard";
import { FIELD_LABEL, ITEM_SECTION } from "../../product/itemPageShared";
import { useTermPage } from "../TermPageContext";

/** Where the term takes place, framed like the item page's location; nothing
 * without a place. */
export function TermLocation() {
  const location = useTermPage().view.group.term?.location;
  if (!location) return null;
  return (
    <section className={`mx-5 ${ITEM_SECTION}`} aria-labelledby="term-location-heading">
      <h3 id="item-location-heading" className={FIELD_LABEL}>
        MIEJSCE
      </h3>
      <PlaceDetails location={location} />
    </section>
  );
}
