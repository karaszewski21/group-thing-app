import type { OwnerItemsPageResponse } from "../../api/ownerItems";
import type { PublicOrganizationResponse } from "../../api/organizations";
import type { OwnerRef } from "../../hooks/useOwnerItems";

export const OWNER_ITEMS_LOAD_ERROR = "Nie udało się wczytać rzeczy.";

/** The one screen `/:slug/items` shows. `notFound` and `error` are handed
 * to the route's `not-found.tsx` and `error.tsx`. */
export type OwnerItemsView =
  | { kind: "loading" }
  | { kind: "redirect"; to: string }
  | {
      kind: "content";
      owner: OwnerItemsPageResponse["owner"];
      counts: OwnerItemsPageResponse["counts"];
      organization: PublicOrganizationResponse | null;
    }
  | { kind: "notFound" }
  | { kind: "error"; message: string };

interface OwnerItemsPageState {
  ownerRef: OwnerRef;
  /** The current query string, kept across the redirect. */
  search: string;
  /** The Organization read for an Organization slug; `null` for a party id. */
  organization: {
    data: PublicOrganizationResponse | null;
    loading: boolean;
    notFound: boolean;
    error: string | null;
  } | null;
  items: {
    owner: OwnerItemsPageResponse["owner"] | null;
    counts: OwnerItemsPageResponse["counts"] | null;
    loading: boolean;
    notFound: boolean;
    error: string | null;
  };
}

/** First match wins: the Organization must load first, a party URL of an
 * Organization owner is replaced by its slug URL, then the first items page
 * decides between loading, not found, error and content. */
export function resolveOwnerItemsView({ ownerRef, search, organization, items }: OwnerItemsPageState): OwnerItemsView {
  if (organization) {
    if (organization.loading) return { kind: "loading" };
    if (organization.notFound) return { kind: "notFound" };
    if (organization.error || !organization.data) return { kind: "error", message: OWNER_ITEMS_LOAD_ERROR };
  }
  const ownerSlug = items.owner?.slug ?? null;
  if (ownerRef.kind === "party" && ownerSlug) return { kind: "redirect", to: `/${ownerSlug}/items${search}` };
  if (items.loading) return { kind: "loading" };
  if (items.notFound) return { kind: "notFound" };
  if (items.error || !items.owner || !items.counts) return { kind: "error", message: OWNER_ITEMS_LOAD_ERROR };
  return { kind: "content", owner: items.owner, counts: items.counts, organization: organization?.data ?? null };
}
