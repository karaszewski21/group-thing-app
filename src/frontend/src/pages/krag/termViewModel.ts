import type { PublicCircleResponse, PublicItemListingResponse } from "../../api/groups";
import type { VisualizationFamily } from "./GroupVisualization";
import type { AttendeeVM } from "./components/AttendeeList";
import type { ListingRowVM } from "./components/termSectionTypes";

/** Everyone in the attendee list: the Term's guardians first, then any
 * lister who offers items without being signed up (e.g. the organizer). */
export function buildAttendees(
  group: PublicCircleResponse,
  toRow: (listing: PublicItemListingResponse) => ListingRowVM,
): AttendeeVM[] {
  const listings = group.term?.item_listings ?? [];
  const people = new Map<number, string>(group.guardians.map((g) => [g.party_id, g.display_name]));
  for (const listing of listings) {
    if (!people.has(listing.lister_party_id)) people.set(listing.lister_party_id, listing.lister_display_name);
  }
  return Array.from(people, ([partyId, name]) => ({
    partyId,
    name,
    listings: listings.filter((l) => l.lister_party_id === partyId).map(toRow),
  }));
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
