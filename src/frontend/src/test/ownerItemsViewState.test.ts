import { describe, expect, it } from "vitest";
import type { PublicOrganizationResponse } from "../api/organizations";
import type { OwnerRef } from "../hooks/useOwnerItems";
import { OWNER_ITEMS_LOAD_ERROR, resolveOwnerItemsView } from "../features/items/ownerItemsViewState";

const ORGANIZATION: PublicOrganizationResponse = {
  slug: "orlik",
  name: "Orlik",
  primary_color: null,
  accent_color: null,
  page_layout: "EXCHANGE",
  palette_preset: null,
  description: null,
  logo: null,
  cover: null,
  gallery: [],
};
const ORG_REF: OwnerRef = { kind: "organization", slug: "orlik" };
const PARTY_REF: OwnerRef = { kind: "party", partyId: "p-1" };
const PERSON = { party_id: "p-1", display_name: "Ania", slug: null };
const ORG_OWNER = { party_id: "p-1", display_name: "Orlik", slug: "orlik" };
const COUNTS = { GIFT: 1, SWAP: 0 };

const orgRead = (overrides = {}) => ({ data: ORGANIZATION, loading: false, notFound: false, error: null, ...overrides });
const itemsRead = (overrides = {}) => ({
  owner: PERSON,
  counts: COUNTS,
  loading: false,
  notFound: false,
  error: null,
  ...overrides,
});

describe("resolveOwnerItemsView", () => {
  it.each([
    ["organization loading", ORG_REF, orgRead({ data: null, loading: true }), itemsRead(), { kind: "loading" }],
    ["organization 404", ORG_REF, orgRead({ data: null, notFound: true }), itemsRead(), { kind: "notFound" }],
    [
      "organization error",
      ORG_REF,
      orgRead({ data: null, error: "boom" }),
      itemsRead(),
      { kind: "error", message: OWNER_ITEMS_LOAD_ERROR },
    ],
    [
      "party URL of an organization owner",
      PARTY_REF,
      null,
      itemsRead({ owner: ORG_OWNER }),
      { kind: "redirect", to: "/orlik/items?event=e1" },
    ],
    ["items loading", PARTY_REF, null, itemsRead({ owner: null, counts: null, loading: true }), { kind: "loading" }],
    ["items 404", PARTY_REF, null, itemsRead({ owner: null, counts: null, notFound: true }), { kind: "notFound" }],
    [
      "items error",
      ORG_REF,
      orgRead(),
      itemsRead({ owner: null, counts: null, error: "boom" }),
      { kind: "error", message: OWNER_ITEMS_LOAD_ERROR },
    ],
    [
      "person content",
      PARTY_REF,
      null,
      itemsRead(),
      { kind: "content", owner: PERSON, counts: COUNTS, organization: null },
    ],
    [
      "organization content on its slug",
      ORG_REF,
      orgRead(),
      itemsRead({ owner: ORG_OWNER }),
      { kind: "content", owner: ORG_OWNER, counts: COUNTS, organization: ORGANIZATION },
    ],
  ])("%s", (_name, ownerRef, organization, items, expected) => {
    expect(resolveOwnerItemsView({ ownerRef, search: "?event=e1", organization, items })).toEqual(expected);
  });
});
