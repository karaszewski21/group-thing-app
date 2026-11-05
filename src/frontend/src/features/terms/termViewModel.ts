import type { PublicCircleResponse, PublicItemListingResponse } from "../../api/groups";
import { PREVIEW_ITEM_LIMIT } from "../../components/shared/ParticipantItemsPreview";
import type { VisualizationFamily } from "./components/visualization/visualizationTypes";
import type { AttendeeVM } from "./components/AttendeeList";

/** Newest listing first; `added_at` is naive UTC ISO, so strings sort as dates. */
function byNewest(a: PublicItemListingResponse, b: PublicItemListingResponse): number {
  if (a.added_at === b.added_at) return 0;
  return a.added_at < b.added_at ? 1 : -1;
}

/** Everyone in the attendee list: the Term's guardians first, then any
 * lister who offers items without being signed up (e.g. the organizer).
 * Each keeps their `PREVIEW_ITEM_LIMIT` newest listings plus the total count;
 * the term page gets every listing, so it sorts and caps here. */
export function buildAttendees(group: PublicCircleResponse): AttendeeVM[] {
  const listings = group.term?.item_listings ?? [];
  const people = new Map<string, string>(group.guardians.map((g) => [g.party_id, g.display_name]));
  for (const listing of listings) {
    if (!people.has(listing.lister_party_id)) people.set(listing.lister_party_id, listing.lister_display_name);
  }
  return Array.from(people, ([partyId, name]) => {
    const own = listings.filter((l) => l.lister_party_id === partyId);
    return {
      partyId,
      name,
      listings: [...own].sort(byNewest).slice(0, PREVIEW_ITEM_LIMIT),
      listingsTotal: own.length,
    };
  });
}

/** The Term's guardians for `GroupVisualization`, flagged by whether they
 * offer an item and whether they bring a needed one. */
export function buildVisualizationFamilies(group: PublicCircleResponse): VisualizationFamily[] {
  const listings = group.term?.item_listings ?? [];
  const neededItems = group.term?.needed_items ?? [];
  return group.guardians.map((g) => ({
    familyId: g.party_id,
    name: g.display_name,
    sharesItem: listings.some((l) => l.lister_party_id === g.party_id),
    bringsItem: neededItems.some((n) => n.claimed_by_party_id === g.party_id),
  }));
}
