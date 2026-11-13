import { describe, expect, it } from "vitest";
import type { SearchResult } from "../api/search";
import { resolveSearchView, type SearchViewInput } from "../features/search/searchViewState";

const PRODUCT: SearchResult = {
  kind: "product",
  id: "it-1",
  title: "Klocki drewniane",
  subtitle: null,
  href: "/zielony-krag/product/it-1",
  meta: { mode: "GIFT", condition: "GOOD", thumb_url: null, reserved: false, reserved_until: null },
};

const EVENT: SearchResult = {
  kind: "event",
  id: "ev-1",
  title: "Kiermasz zabawek",
  subtitle: "Klub Rodzica",
  href: "/klub-rodzica/event/ev-1",
  meta: { starts_at: "2026-11-22T10:00:00", place: "Kraków" },
};

function input(overrides: Partial<SearchViewInput> = {}): SearchViewInput {
  return {
    q: "klocki",
    mode: "items",
    scope: "mine",
    tooShort: false,
    dateRangeInvalid: false,
    loading: false,
    stale: false,
    error: null,
    items: [PRODUCT],
    total: 1,
    otherModeCount: 2,
    ...overrides,
  };
}

describe("resolveSearchView", () => {
  it.each<[string, SearchViewInput, ReturnType<typeof resolveSearchView>]>([
    ["under 2 characters", input({ q: "k", tooShort: true, items: [], total: 0 }), { kind: "hint" }],
    ["hint wins over old results", input({ q: "k", tooShort: true }), { kind: "hint" }],
    ["inverted date range asks for nothing", input({ mode: "events", dateRangeInvalid: true, loading: true, items: [] }), {
      kind: "invalid-range",
    }],
    ["inverted date range hides old results", input({ mode: "events", dateRangeInvalid: true, stale: true }), {
      kind: "invalid-range",
    }],
    ["hint wins over an inverted date range", input({ q: "k", tooShort: true, dateRangeInvalid: true }), { kind: "hint" }],
    ["first page loading", input({ loading: true, items: [], total: 0 }), { kind: "loading" }],
    ["stale empty list while a new q loads", input({ stale: true, items: [], total: 0 }), { kind: "loading" }],
    ["first page failed", input({ error: "Validation failed", items: [], total: 0 }), {
      kind: "error",
      message: "Validation failed",
    }],
    [
      "results",
      input(),
      { kind: "results", items: [PRODUCT], total: 1, otherModeCount: 2, stale: false, refreshError: null },
    ],
    [
      "stale results stay shown while the next q loads",
      input({ stale: true }),
      { kind: "results", items: [PRODUCT], total: 1, otherModeCount: 2, stale: true, refreshError: null },
    ],
    [
      "refresh error keeps the results",
      input({ error: "boom" }),
      { kind: "results", items: [PRODUCT], total: 1, otherModeCount: 2, stale: false, refreshError: "boom" },
    ],
    [
      "no items in my groups",
      input({ items: [], total: 0 }),
      { kind: "empty-items", q: "klocki", scope: "mine", otherModeCount: 2 },
    ],
    [
      "no items anywhere (guest)",
      input({ scope: "all", items: [], total: 0, otherModeCount: 0 }),
      { kind: "empty-items", q: "klocki", scope: "all", otherModeCount: 0 },
    ],
    [
      "no meetings",
      input({ mode: "events", items: [], total: 0, otherModeCount: 4 }),
      { kind: "empty-meetings", q: "klocki", otherModeCount: 4 },
    ],
    [
      "meeting results",
      input({ mode: "events", items: [EVENT], total: 1, otherModeCount: 4 }),
      { kind: "results", items: [EVENT], total: 1, otherModeCount: 4, stale: false, refreshError: null },
    ],
  ])("%s", (_label, state, expected) => {
    expect(resolveSearchView(state)).toEqual(expected);
  });
});
