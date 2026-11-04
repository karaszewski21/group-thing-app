"use client";

import type { ItemLocationResponse } from "../../../api/itemActions";
import { PLACE_LINK, PlaceDetails } from "../../../components/shared/PlaceCard";
import { Link } from "../../../routing/navigation";
import { useItemPage } from "../ItemPageContext";
import { CARD_HINT, FIELD_LABEL, ITEM_SECTION } from "../itemPageShared";
import { itemEditPath } from "../useItemRoutes";

/** "Lokalizacja przedmiotu": the owner sees the address and a way to change
 * the place, anyone else the locality only (the server sends no address,
 * and none is shown or mapped even if it did). */
export function ItemLocation() {
  const { item, view } = useItemPage();
  if (view.kind === "loading" || view.kind === "hidden" || view.kind === "error") return null;
  if (view.kind !== "own" && view.location === null) return null;
  return (
    <section className={ITEM_SECTION} aria-labelledby="item-location-heading">
      <h3 id="item-location-heading" className={FIELD_LABEL}>
        Lokalizacja przedmiotu
      </h3>
      {view.kind === "own" ? (
        <OwnLocation location={view.location} itemId={item.id} />
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

/** The owner's view: the address only they see and a way to change the
 * place; without a live place, personal pickup is off until they set one. */
function OwnLocation({ location, itemId }: { location: ItemLocationResponse | null; itemId: string }) {
  const editLink = (label: string) => (
    <Link to={itemEditPath(itemId)} className={PLACE_LINK}>
      {label}
    </Link>
  );
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
      <p className={CARD_HINT}>
        {usable ? editLink("Zmień lokalizację") : <>Odbiór osobisty niedostępny — {editLink("ustaw lokalizację")}.</>}
      </p>
    </>
  );
}
