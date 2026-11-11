import type {
  MeetingLink,
  OrganizationGroup,
  OrganizationItemStats,
  OrganizationLayoutResponse,
} from "../../../api/organizations";
import type { OwnerItemCard, OwnerNearestDate } from "../../../api/ownerItems";

// Stable empty fallbacks, so a block reading a list its layout does not
// carry gets the same reference on every render.
const NO_DATES: OwnerNearestDate[] = [];
const NO_ITEMS: OwnerItemCard[] = [];
const NO_GROUPS: OrganizationGroup[] = [];
const NO_LINKS: MeetingLink[] = [];

/** Blocks are shared between layouts, so each reads its list through these:
 * a layout whose response lacks the list gets an empty one. */
export function upcomingTermsOf(data: OrganizationLayoutResponse | null): OwnerNearestDate[] {
  return data && "upcoming_terms" in data ? data.upcoming_terms : NO_DATES;
}

export function itemsOf(data: OrganizationLayoutResponse | null): OwnerItemCard[] {
  return data && "items" in data ? data.items : NO_ITEMS;
}

export function groupsOf(data: OrganizationLayoutResponse | null): OrganizationGroup[] {
  return data?.layout === "SCHEDULE" ? data.groups : NO_GROUPS;
}

export function itemStatsOf(data: OrganizationLayoutResponse | null): OrganizationItemStats | null {
  return data?.layout === "SCHEDULE" ? data.item_stats : null;
}

export function termLinksOf(data: OrganizationLayoutResponse | null): MeetingLink[] {
  return data?.layout === "EXCHANGE" ? data.term_links : NO_LINKS;
}
