"use client";

import { PickupPlacesBox } from "../../../components/shared/PickupPlacesBox";
import { useItemPage } from "../ItemPageContext";

/** "Gdzie jeszcze można odebrać": the owner's upcoming terms and events (the
 * server sends them soonest first). Nothing when there are none. */
export function ItemPickupPlaces() {
  const { view } = useItemPage();
  if (view.kind !== "own" && view.kind !== "anonymous" && view.kind !== "choose") return null;
  return <PickupPlacesBox heading="Gdzie jeszcze można odebrać" options={view.contexts} className="mt-4" />;
}
