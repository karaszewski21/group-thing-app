import { describe, expect, it } from "vitest";
import type {
  ItemActionsResponse,
  ItemContextOptionResponse,
  ItemLocationResponse,
  ItemPartyReservationResponse,
} from "../api/itemActions";
import type { ReservedByResponse } from "../api/groups";
import { resolveItemActionsView, type ItemActionsView } from "../pages/product/itemActionsViewState";

const OWNER: ItemActionsResponse["owner"] = {
  party_id: "party-1",
  display_name: "Bartek K.",
  slug: "bartek",
  items_total: 12,
};

const LOCATION: ItemLocationResponse = { name: "Mokotów, Warszawa", formatted_address: null, deleted_at: null };

const ELIGIBLE_TERM: ItemContextOptionResponse = {
  kind: "TERM",
  id: "t-1",
  name: "Wymianka przedszkolna",
  starts_at: "2026-11-07T10:00:00",
  path: "/bartek/group/g-1/term/t-1",
  has_started: false,
  location_name: "Przedszkole nr 12",
  eligible: true,
};

const OTHER_EVENT: ItemContextOptionResponse = {
  kind: "EVENT",
  id: "ev-1",
  name: "Jarmark sąsiedzki",
  starts_at: "2026-11-11T16:00:00",
  path: "/bartek/event/ev-1",
  has_started: false,
  location_name: null,
  eligible: false,
};

const PARTY: ItemPartyReservationResponse = {
  role: "RECEIVER",
  reservation_id: "r-1",
  proposal_id: null,
  reservation_type: "GIFT",
  personal_pickup: true,
  can_confirm: true,
  can_cancel: true,
  can_accept: false,
  can_reject: false,
};

const BY_ANNA: ReservedByResponse = { by_name: "Anna", by_me: false };

function actions(overrides: Partial<ItemActionsResponse> = {}): ItemActionsResponse {
  return {
    mode: "GIFT",
    visibility: null,
    available: true,
    reservation: null,
    party_reservation: null,
    owner: OWNER,
    viewer: "OTHER",
    location: LOCATION,
    contexts: [ELIGIBLE_TERM, OTHER_EVENT],
    personal_pickup_available: true,
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

const CHOOSE: ItemActionsView = {
  kind: "choose",
  owner: OWNER,
  mode: "GIFT",
  location: LOCATION,
  contexts: [ELIGIBLE_TERM, OTHER_EVENT],
  eligibleContexts: [ELIGIBLE_TERM],
  personalPickup: true,
};

describe("resolveItemActionsView", () => {
  it.each<[string, Partial<Input>, ItemActionsView]>([
    ["loading: details pending", { item: null, detailsLoading: true, actions: null }, { kind: "loading" }],
    ["loading: actions pending with no cached data", { actions: null, actionsLoading: true }, { kind: "loading" }],
    [
      "loading: stale data for another session while it refetches (after login)",
      { actions: actions({ viewer: "ANONYMOUS" }), actionsFetching: true },
      { kind: "loading" },
    ],
    [
      "hidden: a deleted item, even when actions failed",
      { item: { deleted: true, isOwner: false }, actions: null, actionsError: "404" },
      { kind: "hidden" },
    ],
    ["error: actions failed with no cached data", { actions: null, actionsError: "Błąd serwera" }, { kind: "error", message: "Błąd serwera" }],
    [
      "own: by viewer, with its party reservation",
      { actions: actions({ viewer: "OWN", visibility: "PUBLIC", party_reservation: { ...PARTY, role: "GIVER" } }) },
      {
        kind: "own",
        mode: "GIFT",
        location: LOCATION,
        contexts: [ELIGIBLE_TERM, OTHER_EVENT],
        visibility: "PUBLIC",
        partyReservation: { ...PARTY, role: "GIVER" },
      },
    ],
    [
      "own: by details",
      { item: { deleted: false, isOwner: true }, actions: actions({ location: null, contexts: [] }) },
      { kind: "own", mode: "GIFT", location: null, contexts: [], visibility: null, partyReservation: null },
    ],
    [
      "own: an unlisted item keeps its null mode",
      { actions: actions({ viewer: "OWN", mode: null, location: null, contexts: [] }) },
      { kind: "own", mode: null, location: null, contexts: [], visibility: null, partyReservation: null },
    ],
    [
      "anonymous: owner, mode and contexts",
      { isLoggedIn: false, actions: actions({ viewer: "ANONYMOUS", mode: "SWAP", location: null }) },
      { kind: "anonymous", owner: OWNER, mode: "SWAP", contexts: [ELIGIBLE_TERM, OTHER_EVENT] },
    ],
    [
      "reserved: a party of the reservation",
      { actions: actions({ available: false, party_reservation: PARTY }) },
      { kind: "reserved", owner: OWNER, reservation: null, partyReservation: PARTY, location: LOCATION },
    ],
    [
      "reserved: a non-party logged-in viewer of a reserved item",
      { actions: actions({ available: false, reservation: BY_ANNA }) },
      { kind: "reserved", owner: OWNER, reservation: BY_ANNA, partyReservation: null, location: LOCATION },
    ],
    [
      "reserved: a pending swap proposal on an AVAILABLE balance, even if `available` were still true",
      { actions: actions({ mode: "SWAP", available: true, reservation: BY_ANNA }) },
      { kind: "reserved", owner: OWNER, reservation: BY_ANNA, partyReservation: null, location: LOCATION },
    ],
    [
      "reserved: an anonymous viewer of a reserved item (no name)",
      {
        isLoggedIn: false,
        actions: actions({
          viewer: "ANONYMOUS",
          available: false,
          location: null,
          reservation: { by_name: null, by_me: false },
        }),
      },
      {
        kind: "reserved",
        owner: OWNER,
        reservation: { by_name: null, by_me: false },
        partyReservation: null,
        location: null,
      },
    ],
    ["unavailable: a non-party of a taken item", { actions: actions({ available: false }) }, { kind: "unavailable", owner: OWNER }],
    ["unavailable: no listing mode", { actions: actions({ mode: null }) }, { kind: "unavailable", owner: OWNER }],
    ["choose: a location and an eligible context", {}, CHOOSE],
    [
      "choose: without a location or eligible contexts",
      { actions: actions({ location: null, personal_pickup_available: false, contexts: [OTHER_EVENT] }) },
      { ...CHOOSE, location: null, contexts: [OTHER_EVENT], eligibleContexts: [], personalPickup: false },
    ],
    [
      "choose: a refresh error with cached data keeps the last view",
      { actionsError: "Błąd serwera", actionsFetching: false },
      CHOOSE,
    ],
    [
      "anonymous: a finished refetch for another session is shown as it is",
      { actions: actions({ viewer: "ANONYMOUS" }), actionsFetching: false },
      { kind: "anonymous", owner: OWNER, mode: "GIFT", contexts: [ELIGIBLE_TERM, OTHER_EVENT] },
    ],
  ])("%s", (_name, overrides, expected) => {
    expect(resolveItemActionsView({ ...BASE, ...overrides })).toEqual(expected);
  });
});
