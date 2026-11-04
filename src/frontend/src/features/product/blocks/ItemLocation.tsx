"use client";

import type { ItemLocationResponse } from "../../../api/itemActions";
import { PlaceDetails } from "../../../components/shared/PlaceCard";
import { useItemPage } from "../ItemPageContext";
import { CARD_HINT, FIELD_LABEL, ITEM_SECTION } from "../itemPageShared";

/** "Lokalizacja przedmiotu": the owner sees the address, anyone else the locality only (the server sends no address,
 * and none is shown or mapped even if it did). */
export function ItemLocation() {
  const { view } = useItemPage();
  if (view.kind === "loading" || view.kind === "hidden" || view.kind === "error") return null;
  if (view.kind !== "own" && view.location === null) return null;
  return (
    <section className={ITEM_SECTION} aria-labelledby="item-location-heading">
      <h3 id="item-location-heading" className={FIELD_LABEL}>
        Lokalizacja przedmiotu
      </h3>
      {view.kind === "own" ? (
        <OwnLocation location={view.location} />
      ) : (
        view.location && (
          <>
            <PlaceDetails location={{ ...view.location, formatted_address: null }} />
            {view.kind === "choose" && view.personalPickup && <p className={CARD_HINT}>Odbiór osobisty dostępny.</p>}
          </>
        )
      )}
    </section>
  );
}

/** The owner's view: the address only they see; without a live place,
 * personal pickup is off until they set one in the item's edit page. */
function OwnLocation({ location }: { location: ItemLocationResponse | null }) {
  const usable = location !== null && location.deleted_at === null;
  return (
    <>
      {location && <PlaceDetails location={location} deleted={!usable} showAddress={false} />}
      {usable && location.formatted_address && (
        <p className="mt-2.5 rounded-xl bg-cream px-3 py-2 text-[13px] wrap-break-word text-ink">
          <em className="block text-[11px] font-bold text-ink-soft not-italic">Widoczne tylko dla Ciebie</em>
          {location.formatted_address}
        </p>
      )}
      {!usable && <p className={CARD_HINT}>Odbiór osobisty niedostępny — ustaw lokalizację w edycji rzeczy.</p>}
    </>
  );
}
