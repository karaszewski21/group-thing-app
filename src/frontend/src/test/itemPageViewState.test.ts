import { describe, expect, it } from "vitest";
import type { ItemDetailsResponse } from "../api/items";
import { resolveItemPageView } from "../features/product/itemPageViewState";

const ITEM: ItemDetailsResponse = {
  id: "it-1",
  product_id: "p-1",
  name: "Rowerek biegowy",
  category_id: "c-1",
  category_name: null,
  condition: "GOOD",
  listing_status: "ACTIVE",
  description: null,
  photos: [],
  product_photo_url: null,
  is_owner: false,
  location_id: null,
  deleted_at: null,
  status: { code: "AVAILABLE", term_occurs_on: null, due_date: null, counterparty_label: null, personal_pickup: false },
};

const BASE = {
  slug: "ania",
  id: "it-1",
  search: "",
  ownerSlug: null,
  item: null,
  notFound: false,
  error: null,
  isLoggedIn: true,
};

describe("resolveItemPageView", () => {
  it.each([
    { state: "details pending", input: {}, expected: { kind: "loading" } },
    { state: "loaded", input: { item: ITEM, ownerSlug: "ania" }, expected: { kind: "content", item: ITEM } },
    {
      state: "a stale prefix, keeping the query",
      input: { item: ITEM, ownerSlug: "nowy-slug", search: "?event=ev-1" },
      expected: { kind: "redirect", to: "/nowy-slug/product/it-1?event=ev-1" },
    },
    { state: "a 404 for a logged-in viewer", input: { notFound: true }, expected: { kind: "notFound" } },
    { state: "a 404 for an anonymous visitor", input: { notFound: true, isLoggedIn: false }, expected: { kind: "loginRequired" } },
    { state: "a failed read", input: { error: "Awaria serwera" }, expected: { kind: "error", message: "Awaria serwera" } },
    {
      state: "a failed refresh with loaded details",
      input: { item: ITEM, error: "Awaria serwera" },
      expected: { kind: "content", item: ITEM },
    },
  ])("$state", ({ input, expected }) => {
    expect(resolveItemPageView({ ...BASE, ...input })).toEqual(expected);
  });
});
