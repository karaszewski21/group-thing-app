import { describe, expect, it } from "vitest";
import type { ItemActionsResponse } from "../api/itemActions";
import { resolveItemActionsView, type ItemActionsView } from "../pages/product/itemActionsViewState";

const OWNER: ItemActionsResponse["owner"] = {
  party_id: "party-1",
  display_name: "Bartek K.",
  slug: "bartek",
  items_total: 12,
};

const LIVE: NonNullable<ItemActionsResponse["context"]> = {
  kind: "EVENT",
  id: "ev-1",
  name: "Wymianka sąsiedzka",
  starts_at: "2026-11-07T10:00:00",
  path: "/bartek/event/ev-1",
  has_started: false,
};

const STARTED = { ...LIVE, has_started: true };

const NEAREST: NonNullable<ItemActionsResponse["nearest"]> = {
  kind: "TERM",
  id: "term-2",
  name: "Wymianka zimowa",
  starts_at: "2026-11-22T10:00:00",
  location_name: null,
  attendee_count: 3,
  path: "/bartek/group/g-1/term/term-2",
};

function actions(overrides: Partial<ItemActionsResponse> = {}): ItemActionsResponse {
  return {
    mode: "GIFT",
    available: true,
    owner: OWNER,
    context: LIVE,
    viewer: "ELIGIBLE",
    nearest: null,
    ...overrides,
  };
}

type Input = Parameters<typeof resolveItemActionsView>[0];

const BASE: Input = {
  item: { deleted: false, isOwner: false },
  detailsLoading: false,
  actions: actions(),
  actionsLoading: false,
  actionsFetching: false,
  actionsError: null,
  isLoggedIn: true,
};

describe("resolveItemActionsView", () => {
  it.each<[string, Partial<Input>, ItemActionsView]>([
    ["1. details pending", { item: null, detailsLoading: true, actions: null }, { kind: "loading" }],
    ["1. actions pending with no cached data", { actions: null, actionsLoading: true }, { kind: "loading" }],
    [
      "1. data for another session while it refetches (after login)",
      { actions: actions({ viewer: "ANONYMOUS" }), actionsFetching: true },
      { kind: "loading" },
    ],
    ["2. a deleted item, even when actions failed", { item: { deleted: true, isOwner: false }, actions: null, actionsError: "404" }, { kind: "hidden" }],
    ["3. actions failed with no cached data", { actions: null, actionsError: "Błąd serwera" }, { kind: "error", message: "Błąd serwera" }],
    ["4. own by viewer", { actions: actions({ viewer: "OWN" }) }, { kind: "own", contextName: "Wymianka sąsiedzka" }],
    [
      "4. own by details, without a context",
      { item: { deleted: false, isOwner: true }, actions: actions({ context: null, viewer: "ELIGIBLE" }) },
      { kind: "own", contextName: null },
    ],
    ["5. not available", { actions: actions({ available: false }) }, { kind: "unavailable", owner: OWNER }],
    ["5. no listing mode", { actions: actions({ mode: null }) }, { kind: "unavailable", owner: OWNER }],
    [
      "5. anonymous + unavailable → unavailable",
      { isLoggedIn: false, actions: actions({ viewer: "ANONYMOUS", available: false }) },
      { kind: "unavailable", owner: OWNER },
    ],
    [
      "6. no context, with a nearest date",
      { actions: actions({ context: null, nearest: NEAREST }) },
      { kind: "noContext", owner: OWNER, nearest: NEAREST },
    ],
    [
      "6. anonymous + no context → noContext",
      { isLoggedIn: false, actions: actions({ viewer: "ANONYMOUS", context: null }) },
      { kind: "noContext", owner: OWNER, nearest: null },
    ],
    [
      "7. a started context",
      { actions: actions({ context: STARTED, nearest: NEAREST }) },
      { kind: "stale", context: STARTED, owner: OWNER, nearest: NEAREST },
    ],
    [
      "7. anonymous + stale → stale",
      { isLoggedIn: false, actions: actions({ viewer: "ANONYMOUS", context: STARTED }) },
      { kind: "stale", context: STARTED, owner: OWNER, nearest: null },
    ],
    [
      "8. anonymous with a live context",
      { isLoggedIn: false, actions: actions({ viewer: "ANONYMOUS", mode: "SWAP" }) },
      { kind: "anonymous", context: LIVE, mode: "SWAP", owner: OWNER },
    ],
    [
      "9. not signed up",
      { actions: actions({ viewer: "NOT_ELIGIBLE" }) },
      { kind: "notSignedUp", context: LIVE, owner: OWNER },
    ],
    ["10. eligible", {}, { kind: "eligible", context: LIVE, mode: "GIFT", owner: OWNER }],
    [
      "a refresh error with cached data keeps the last view",
      { actionsError: "Błąd serwera", actionsFetching: false },
      { kind: "eligible", context: LIVE, mode: "GIFT", owner: OWNER },
    ],
    [
      "a finished refetch for another session is shown as it is",
      { actions: actions({ viewer: "ANONYMOUS" }), actionsFetching: false },
      { kind: "anonymous", context: LIVE, mode: "GIFT", owner: OWNER },
    ],
  ])("%s", (_name, overrides, expected) => {
    expect(resolveItemActionsView({ ...BASE, ...overrides })).toEqual(expected);
  });
});
