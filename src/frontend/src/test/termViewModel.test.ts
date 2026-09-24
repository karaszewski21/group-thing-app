import { describe, expect, it } from "vitest";
import type { PublicCircleResponse, PublicItemListingResponse } from "../api/groups";
import { buildAttendees, buildVisualizationFamilies } from "../pages/krag/termViewModel";

function listing(itemId: number, listerPartyId: number, listerName: string): PublicItemListingResponse {
  return { item_id: itemId, lister_party_id: listerPartyId, lister_display_name: listerName } as PublicItemListingResponse;
}

const group = {
  guardians: [
    { party_id: 1, display_name: "Ola" },
    { party_id: 2, display_name: "Ewa" },
  ],
  term: {
    item_listings: [listing(10, 1, "Ola"), listing(11, 9, "Ania Kowalska")],
    needed_items: [{ id: 5, claimed_by_party_id: 2 }],
  },
} as unknown as PublicCircleResponse;

describe("termViewModel", () => {
  it("buildAttendees_listsGuardiansFirst_thenNonAttendingListers_withOwnListings", () => {
    const attendees = buildAttendees(group, (l) => ({ key: l.item_id }) as never);

    expect(attendees.map((a) => [a.partyId, a.name, a.listings.map((r) => r.key)])).toEqual([
      [1, "Ola", [10]],
      [2, "Ewa", []],
      [9, "Ania Kowalska", [11]],
    ]);
  });

  it("buildVisualizationFamilies_flagsSharersAndBringers_guardiansOnly", () => {
    expect(buildVisualizationFamilies(group)).toEqual([
      { familyId: 1, name: "Ola", sharesItem: true, bringsItem: false },
      { familyId: 2, name: "Ewa", sharesItem: false, bringsItem: true },
    ]);
  });

  it("noTerm_givesNoListingsAndNoFlags", () => {
    const empty = { ...group, term: null } as PublicCircleResponse;

    expect(buildAttendees(empty, () => ({}) as never).every((a) => a.listings.length === 0)).toBe(true);
    expect(buildVisualizationFamilies(empty).some((f) => f.sharesItem || f.bringsItem)).toBe(false);
  });
});
