import type { OwnerItemsPageResponse } from "../../api/ownerItems";
import type { PublicOrganizationResponse } from "../../api/organizations";

export const OWNER_ITEMS_LOAD_ERROR = "Nie udało się wczytać rzeczy.";

/** The one screen `/:slug/items` shows. `notFound` and `error` are handed
 * to the route's `not-found.tsx` and `error.tsx`. */
export type OwnerItemsView =
  | { kind: "loading" }
  | {
      kind: "content";
      owner: OwnerItemsPageResponse["owner"];
      counts: OwnerItemsPageResponse["counts"];
      organization: PublicOrganizationResponse | null;
    }
  | { kind: "notFound" }
  | { kind: "error"; message: string };

interface OwnerItemsPageState {
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

/** First match wins: the Organization must load first, then the first items page
 * decides between loading, not found, error and content. */
export function resolveOwnerItemsView({ organization, items }: OwnerItemsPageState): OwnerItemsView {
  if (organization) {
    if (organization.loading) return { kind: "loading" };
    if (organization.notFound) return { kind: "notFound" };
    if (organization.error || !organization.data) return { kind: "error", message: OWNER_ITEMS_LOAD_ERROR };
  }
  if (items.loading) return { kind: "loading" };
  if (items.notFound) return { kind: "notFound" };
  if (items.error || !items.owner || !items.counts) return { kind: "error", message: OWNER_ITEMS_LOAD_ERROR };
  return { kind: "content", owner: items.owner, counts: items.counts, organization: organization?.data ?? null };
}
