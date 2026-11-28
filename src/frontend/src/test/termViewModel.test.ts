import { describe, expect, it } from "vitest";
import type { PublicCircleResponse, PublicItemListingResponse } from "../api/groups";
import { buildAttendees, buildVisualizationFamilies } from "../features/terms/termViewModel";

/** A fully typed listing of Ola's, so `tsc` catches DTO drift. */
function olaListing(itemId: string, addedAt: string, isFeatured: boolean): PublicItemListingResponse {
  return {
    id: `l-${itemId}`,
    item_id: itemId,
    product_name: `Rzecz ${itemId}`,
    condition: "GOOD",
    offered_types: ["GIFT"],
    lister_party_id: "1",
    lister_display_name: "Ola",
    thumb_url: null,
    added_at: addedAt,
    reservation: null,
    is_featured: isFeatured,
  };
}

function circleWith(listings: PublicItemListingResponse[]): PublicCircleResponse {
  return {
    id: "g-1",
    name: "Krąg",
    organizer_display_name: null,
    organizer_slug: null,
    organizer_party_id: null,
    visibility: "PUBLIC",
    layout_mode: "CIRCLE",
    organization: null,
    guardians: [{ party_id: "1", display_name: "Ola" }],
    term: {
      id: "t-1",
      occurs_on: "2026-12-06T10:00:00",
      description: null,
      needed_items: [],
      item_listings: listings,
      price: null,
      payment_url: null,
      payment_method: null,
    },
  };
}

function listing(itemId: string, listerPartyId: string, listerName: string): PublicItemListingResponse {
  return {
    item_id: itemId,
    lister_party_id: listerPartyId,
    lister_display_name: listerName,
    offered_types: [],
  } as unknown as PublicItemListingResponse;
}

const group = {
  guardians: [
    { party_id: "1", display_name: "Ola" },
    { party_id: "2", display_name: "Ewa" },
  ],
  term: {
    item_listings: [listing("10", "1", "Ola"), listing("11", "9", "Ania Kowalska")],
    needed_items: [{ id: "5", claimed_by_party_id: "2" }],
  },
} as unknown as PublicCircleResponse;

describe("termViewModel", () => {
  it("buildAttendees_listsGuardiansFirst_thenNonAttendingListers_withOwnListings", () => {
    const attendees = buildAttendees(group);

    expect(attendees.map((a) => [a.partyId, a.name, a.items.map((i) => i.itemId)])).toEqual([
      ["1", "Ola", ["10"]],
      ["2", "Ewa", []],
      ["9", "Ania Kowalska", ["11"]],
    ]);
  });

  it("buildAttendees_putsFeaturedFirstInServerOrder_thenNewest_beforeTheSliceToThree", () => {
    // The server sends featured items most recently featured first.
    const listings = [
      olaListing("old", "2026-10-01T09:00:00", false),
      olaListing("f-recent", "2026-09-01T09:00:00", true),
      olaListing("new", "2026-11-01T09:00:00", false),
      olaListing("f-earlier", "2026-11-02T09:00:00", true),
    ];

    const [ola] = buildAttendees(circleWith(listings));

    expect(ola.items.map((i) => [i.itemId, i.featured])).toEqual([
      ["f-recent", true],
      ["f-earlier", true],
      ["new", false],
    ]);
    expect(ola.itemsTotal).toBe(4);
  });

  it("buildAttendees_cutsAFourthFeaturedItemAtTheSlice", () => {
    const listings = ["f1", "f2", "f3", "f4"].map((id) => olaListing(id, "2026-11-01T09:00:00", true));

    const [ola] = buildAttendees(circleWith([olaListing("plain", "2026-11-20T09:00:00", false), ...listings]));

    expect(ola.items.map((i) => i.itemId)).toEqual(["f1", "f2", "f3"]);
  });

  it("buildVisualizationFamilies_flagsSharersAndBringers_guardiansOnly", () => {
    expect(buildVisualizationFamilies(group)).toEqual([
      { familyId: "1", name: "Ola", sharesItem: true, bringsItem: false },
      { familyId: "2", name: "Ewa", sharesItem: false, bringsItem: true },
    ]);
  });

  it("noTerm_givesNoListingsAndNoFlags", () => {
    const empty = { ...group, term: null } as PublicCircleResponse;

    expect(buildAttendees(empty).every((a) => a.items.length === 0)).toBe(true);
    expect(buildVisualizationFamilies(empty).some((f) => f.sharesItem || f.bringsItem)).toBe(false);
  });
});
