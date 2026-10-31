import { useParams } from "react-router-dom";
import type { OwnerNearestDate } from "../../api/ownerItems";

interface ItemRoutes {
  viewPath: (id: string) => string;
  /** Where "Wróć" goes when the page was opened directly. */
  backFallback: string;
}

/** The backend's stand-in slug (`k-` + 12 hex) for an organizer without an
 * Organization: it has no organizer page to go back to. */
const FALLBACK_ORGANIZER_SLUG = /^k-[0-9a-f]{12}$/;

/** The term or event an item page was opened from, carried as `?term=`/`?event=`. */
export interface ItemContext {
  kind: "term" | "event";
  id: string;
}

/** The server's uppercase context kind as the URL's `term`/`event`; the one
 * place the two spellings meet. */
export function itemContextKind(kind: "TERM" | "EVENT"): ItemContext["kind"] {
  return kind === "EVENT" ? "event" : "term";
}

/** The item context of an owner's nearest public term or event. */
export function nearestItemContext(nearest: OwnerNearestDate | null): ItemContext | null {
  return nearest ? { kind: itemContextKind(nearest.kind), id: nearest.id } : null;
}

/** `?term=<id>` / `?event=<id>`, or "" without a context. */
export function itemContextQuery(context?: ItemContext | null): string {
  return context ? `?${context.kind}=${encodeURIComponent(context.id)}` : "";
}

/** An item's page under its organizer's prefix, or the panel-wide
 * `/product/:id` when there is no organizer slug; `context` appends the term
 * or event it was opened from. */
export function organizerItemPath(
  organizerSlug: string | null | undefined,
  id: string,
  context?: ItemContext | null,
): string {
  const path = organizerSlug ? `/${organizerSlug}/product/${id}` : `/product/${id}`;
  return `${path}${itemContextQuery(context)}`;
}

/** An item page opened in edit mode (`?edit=1`, see `ItemDetailPage`). */
export function itemEditPath(viewPath: string): string {
  return `${viewPath}?edit=1`;
}

/** Item page paths: under `/:organizationSlug/product` on the organizer
 * route, under `/product` everywhere else. */
export function useItemRoutes(): ItemRoutes {
  const { organizationSlug } = useParams();
  const hasOrganizerPage = !!organizationSlug && !FALLBACK_ORGANIZER_SLUG.test(organizationSlug);
  return {
    viewPath: (id) => organizerItemPath(organizationSlug, id),
    backFallback: hasOrganizerPage ? `/${organizationSlug}` : "/items",
  };
}
