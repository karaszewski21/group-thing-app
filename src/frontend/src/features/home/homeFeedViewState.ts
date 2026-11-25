import type { Locality } from "../../api/locations";
import type { SearchResult } from "../../api/search";
import type { Coordinates } from "../../hooks/useNearestLocality";

/** Where the browser's location stands: `checking` until the permission is
 * known, `ask` while the visitor has not decided, `off` when they declined,
 * turned it off or the browser cannot locate; `canTurnOn` is false when the
 * page cannot ask again (no geolocation, or the browser blocks it). */
export type LocationConsent =
  | { kind: "checking" }
  | { kind: "ask" }
  | { kind: "locating" }
  | { kind: "located"; point: Coordinates }
  | { kind: "off"; canTurnOn: boolean };

/** What the home feed lists: `pending` while it is not yet known where to
 * look, the newest items and the soonest meetings (`recent`), or those
 * around the visitor's locality (`nearby`). A `recent` feed asks for the
 * location with the prompt card (`ask`), offers to turn it on (`turnOn`) or
 * neither (`none`). */
export type HomeFeedView =
  | { kind: "pending" }
  | { kind: "recent"; location: "ask" | "turnOn" | "none" }
  | { kind: "nearby"; locality: Locality };

export function resolveHomeFeedView(
  consent: LocationConsent,
  nearest: { data: Locality | null; loading: boolean },
): HomeFeedView {
  switch (consent.kind) {
    case "checking":
    case "locating":
      return { kind: "pending" };
    case "ask":
      return { kind: "recent", location: "ask" };
    case "off":
      return { kind: "recent", location: consent.canTurnOn ? "turnOn" : "none" };
    case "located":
      if (nearest.loading) return { kind: "pending" };
      // No locality near the point (or the lookup failed): the newest instead.
      return nearest.data ? { kind: "nearby", locality: nearest.data } : { kind: "recent", location: "none" };
  }
}

/** The part of `useSearch` one section reads. */
export interface SectionSearch {
  items: SearchResult[];
  loading: boolean;
  error: string | null;
}

/** One section of the feed. `fallback` marks the newest shown because
 * nothing was found near the visitor. */
export type HomeSectionView =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | { kind: "results"; items: SearchResult[]; source: "nearby" | "recent"; fallback: boolean };

/** `nearby` is `null` unless the feed lists around a locality; then an empty
 * nearby list falls back to `recent`. */
export function resolveHomeSectionView(
  pending: boolean,
  nearby: SectionSearch | null,
  recent: SectionSearch,
): HomeSectionView {
  if (pending) return { kind: "loading" };
  if (nearby) {
    if (nearby.loading) return { kind: "loading" };
    if (nearby.error) return { kind: "error", message: nearby.error };
    if (nearby.items.length > 0) return { kind: "results", items: nearby.items, source: "nearby", fallback: false };
  }
  if (recent.loading) return { kind: "loading" };
  if (recent.error) return { kind: "error", message: recent.error };
  if (recent.items.length === 0) return { kind: "empty" };
  return { kind: "results", items: recent.items, source: "recent", fallback: nearby !== null };
}
