import { describe, expect, it } from "vitest";
import type { SearchResult } from "../api/search";
import type { Locality } from "../api/locations";
import {
  resolveHomeFeedView,
  resolveHomeSectionView,
  type HomeFeedView,
  type HomeSectionView,
  type LocationConsent,
  type SectionSearch,
} from "../features/home/homeFeedViewState";
import { makeLocality } from "./fixtures/locations";

const KETY = makeLocality();
const POINT = { lat: 49.88, lng: 19.22 };
const ITEM: SearchResult = {
  kind: "product",
  id: "it-1",
  title: "Rowerek",
  subtitle: null,
  href: "/ania/product/it-1",
  meta: { mode: "GIFT", points_price: null, condition: "GOOD", thumb_url: null, reserved: false, reserved_until: null },
};

describe("resolveHomeFeedView", () => {
  it.each<[string, LocationConsent, { data: Locality | null; loading: boolean }, HomeFeedView]>([
    ["permission unknown yet", { kind: "checking" }, { data: null, loading: false }, { kind: "pending" }],
    ["browser locating", { kind: "locating" }, { data: null, loading: false }, { kind: "pending" }],
    ["undecided visitor", { kind: "ask" }, { data: null, loading: false }, { kind: "recent", location: "ask" }],
    [
      "declined or turned off",
      { kind: "off", canTurnOn: true },
      { data: null, loading: false },
      { kind: "recent", location: "turnOn" },
    ],
    [
      "blocked by the browser",
      { kind: "off", canTurnOn: false },
      { data: null, loading: false },
      { kind: "recent", location: "none" },
    ],
    ["locality loading", { kind: "located", point: POINT }, { data: null, loading: true }, { kind: "pending" }],
    ["locality found", { kind: "located", point: POINT }, { data: KETY, loading: false }, { kind: "nearby", locality: KETY }],
    [
      "no locality near",
      { kind: "located", point: POINT },
      { data: null, loading: false },
      { kind: "recent", location: "none" },
    ],
  ])("%s", (_label, consent, nearest, expected) => {
    expect(resolveHomeFeedView(consent, nearest)).toEqual(expected);
  });
});

const search = (overrides: Partial<SectionSearch> = {}): SectionSearch => ({
  items: [],
  loading: false,
  error: null,
  ...overrides,
});

describe("resolveHomeSectionView", () => {
  it.each<[string, boolean, SectionSearch | null, SectionSearch, HomeSectionView]>([
    ["feed pending", true, null, search({ items: [ITEM] }), { kind: "loading" }],
    ["recent loading", false, null, search({ loading: true }), { kind: "loading" }],
    ["recent error", false, null, search({ error: "Błąd" }), { kind: "error", message: "Błąd" }],
    ["recent empty", false, null, search(), { kind: "empty" }],
    [
      "recent results",
      false,
      null,
      search({ items: [ITEM] }),
      { kind: "results", items: [ITEM], source: "recent", fallback: false },
    ],
    ["nearby loading", false, search({ loading: true }), search({ loading: true }), { kind: "loading" }],
    ["nearby error", false, search({ error: "Błąd" }), search(), { kind: "error", message: "Błąd" }],
    [
      "nearby results",
      false,
      search({ items: [ITEM] }),
      search({ loading: true }),
      { kind: "results", items: [ITEM], source: "nearby", fallback: false },
    ],
    ["nearby empty, recent loading", false, search(), search({ loading: true }), { kind: "loading" }],
    [
      "nearby empty falls back to recent",
      false,
      search(),
      search({ items: [ITEM] }),
      { kind: "results", items: [ITEM], source: "recent", fallback: true },
    ],
    ["nothing anywhere", false, search(), search(), { kind: "empty" }],
  ])("%s", (_label, pending, nearby, recent, expected) => {
    expect(resolveHomeSectionView(pending, nearby, recent)).toEqual(expected);
  });
});
