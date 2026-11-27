import { describe, expect, it } from "vitest";
import type {
  ItemActionsResponse,
  ItemContextOptionResponse,
  ItemLocationResponse,
  ItemPartyReservationResponse,
} from "../api/itemActions";
import type { ReservedByResponse } from "../api/groups";
import { resolveItemActionsView, type ItemActionsView } from "../features/product/itemActionsViewState";
import { makeItemLocation } from "./fixtures/locations";

const OWNER: ItemActionsResponse["owner"] = {
  party_id: "party-1",
  display_name: "Bartek K.",
  slug: "bartek",
  items_total: 12,
};

const LOCATION: ItemLocationResponse = makeItemLocation();
const OWN_LOCATION: ItemLocationResponse = makeItemLocation({ formatted_address: "ul. Sienkiewicza 1, 32-650 Kęty" });
const DELETED_LOCATION: ItemLocationResponse = { ...OWN_LOCATION, deleted_at: "2026-11-01T09:00:00" };

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
  held_points: null,
};

const BY_ANNA: ReservedByResponse = { by_name: "Anna", by_me: false };

function actions(overrides: Partial<ItemActionsResponse> = {}): ItemActionsResponse {
  return {
    mode: "GIFT",
    points_price: null,
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
  pointsPrice: null,
};

const NO_POINTS_OWN = { pointsPrice: null, heldPoints: null };

const POINTS_BUYER: ItemPartyReservationResponse = {
  ...PARTY,
  reservation_type: "POINTS",
  held_points: 50,
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
        pointsPrice: null,
        heldPoints: null,
      },
    ],
    [
      "own: the owner's address shape is passed through",
      { actions: actions({ viewer: "OWN", location: OWN_LOCATION, contexts: [] }) },
      { kind: "own", mode: "GIFT", location: OWN_LOCATION, contexts: [], visibility: null, partyReservation: null, ...NO_POINTS_OWN },
    ],
    [
      "own: a deleted place keeps its deleted_at for the (usunięte) card",
      { actions: actions({ viewer: "OWN", location: DELETED_LOCATION, contexts: [] }) },
      { kind: "own", mode: "GIFT", location: DELETED_LOCATION, contexts: [], visibility: null, partyReservation: null, ...NO_POINTS_OWN },
    ],
    [
      "own: by details",
      { item: { deleted: false, isOwner: true }, actions: actions({ location: null, contexts: [] }) },
      { kind: "own", mode: "GIFT", location: null, contexts: [], visibility: null, partyReservation: null, ...NO_POINTS_OWN },
    ],
    [
      "own: an unlisted item keeps its null mode",
      { actions: actions({ viewer: "OWN", mode: null, location: null, contexts: [] }) },
      { kind: "own", mode: null, location: null, contexts: [], visibility: null, partyReservation: null, ...NO_POINTS_OWN },
    ],
    [
      "anonymous: owner, mode and contexts",
      { isLoggedIn: false, actions: actions({ viewer: "ANONYMOUS", mode: "SWAP", location: null }) },
      { kind: "anonymous", owner: OWNER, mode: "SWAP", location: null, contexts: [ELIGIBLE_TERM, OTHER_EVENT], pointsPrice: null },
    ],
    [
      "anonymous: the locality-only place for the location card",
      { isLoggedIn: false, actions: actions({ viewer: "ANONYMOUS" }) },
      { kind: "anonymous", owner: OWNER, mode: "GIFT", location: LOCATION, contexts: [ELIGIBLE_TERM, OTHER_EVENT], pointsPrice: null },
    ],
    [
      "reserved: a party of the reservation",
      { actions: actions({ available: false, party_reservation: PARTY }) },
      { kind: "reserved", owner: OWNER, reservation: null, partyReservation: PARTY, location: LOCATION, heldPoints: null },
    ],
    [
      "reserved: a non-party logged-in viewer of a reserved item",
      { actions: actions({ available: false, reservation: BY_ANNA }) },
      { kind: "reserved", owner: OWNER, reservation: BY_ANNA, partyReservation: null, location: LOCATION, heldPoints: null },
    ],
    [
      "reserved: a pending swap proposal on an AVAILABLE balance, even if `available` were still true",
      { actions: actions({ mode: "SWAP", available: true, reservation: BY_ANNA }) },
      { kind: "reserved", owner: OWNER, reservation: BY_ANNA, partyReservation: null, location: LOCATION, heldPoints: null },
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
        heldPoints: null,
      },
    ],
    [
      "unavailable: a non-party of a taken item",
      { actions: actions({ available: false }) },
      { kind: "unavailable", owner: OWNER, location: LOCATION },
    ],
    [
      "unavailable: no listing mode and no place",
      { actions: actions({ mode: null, location: null }) },
      { kind: "unavailable", owner: OWNER, location: null },
    ],
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
      { kind: "anonymous", owner: OWNER, mode: "GIFT", location: LOCATION, contexts: [ELIGIBLE_TERM, OTHER_EVENT], pointsPrice: null },
    ],
    [
      "choose (POINTS): a buyer gets the owner's price",
      { actions: actions({ mode: "POINTS", points_price: 60 }) },
      { ...CHOOSE, mode: "POINTS", pointsPrice: 60 },
    ],
    [
      "own (POINTS): the owner of a reserved item sees the held points",
      {
        actions: actions({
          viewer: "OWN",
          mode: "POINTS",
          points_price: 60,
          available: false,
          contexts: [],
          party_reservation: { ...POINTS_BUYER, role: "GIVER", can_confirm: false },
        }),
      },
      {
        kind: "own",
        mode: "POINTS",
        location: LOCATION,
        contexts: [],
        visibility: null,
        partyReservation: { ...POINTS_BUYER, role: "GIVER", can_confirm: false },
        pointsPrice: 60,
        heldPoints: 50,
      },
    ],
    [
      "reserved (POINTS): the buyer after pickup keeps the held points of the hold",
      { actions: actions({ mode: "POINTS", points_price: 70, available: false, party_reservation: POINTS_BUYER }) },
      { kind: "reserved", owner: OWNER, reservation: null, partyReservation: POINTS_BUYER, location: LOCATION, heldPoints: 50 },
    ],
    [
      "anonymous (POINTS): a guest sees the price",
      { isLoggedIn: false, actions: actions({ viewer: "ANONYMOUS", mode: "POINTS", points_price: 60 }) },
      {
        kind: "anonymous",
        owner: OWNER,
        mode: "POINTS",
        location: LOCATION,
        contexts: [ELIGIBLE_TERM, OTHER_EVENT],
        pointsPrice: 60,
      },
    ],
  ])("%s", (_name, overrides, expected) => {
    expect(resolveItemActionsView({ ...BASE, ...overrides })).toEqual(expected);
  });
});
