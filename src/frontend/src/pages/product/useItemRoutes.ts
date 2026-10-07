import { useParams } from "react-router-dom";

interface ItemRoutes {
  viewPath: (id: string) => string;
  editPath: (id: string) => string;
  /** Where "Wróć" goes when the page was opened directly. */
  backFallback: string;
}

/** The backend's stand-in slug (`k-` + 12 hex) for an organizer without an
 * Organization: it has no organizer page to go back to. */
const FALLBACK_ORGANIZER_SLUG = /^k-[0-9a-f]{12}$/;

/** An item's page under its organizer's prefix, or the panel-wide
 * `/product/:id` when there is no organizer slug. */
export function organizerItemPath(organizerSlug: string | null | undefined, id: string): string {
  return organizerSlug ? `/${organizerSlug}/produkt/${id}` : `/product/${id}`;
}

/** Item page paths: under `/:organizationSlug/produkt` on the organizer
 * route, under `/product` everywhere else. */
export function useItemRoutes(): ItemRoutes {
  const { organizationSlug } = useParams();
  const hasOrganizerPage = !!organizationSlug && !FALLBACK_ORGANIZER_SLUG.test(organizationSlug);
  return {
    viewPath: (id) => organizerItemPath(organizationSlug, id),
    editPath: (id) => `${organizerItemPath(organizationSlug, id)}/edit`,
    backFallback: hasOrganizerPage ? `/${organizationSlug}` : "/panel/rzeczy",
  };
}
