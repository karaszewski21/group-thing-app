import type { ExchangeMode } from "../../../api/groups";
import type {
  ItemActionsResponse,
  ItemContextOptionResponse,
  ItemLocationResponse,
  ItemPartyReservationResponse,
} from "../../../api/itemActions";

type Owner = ItemActionsResponse["owner"];

/** The one state the item page's actions card shows (spec R5.2). */
export type ItemActionsView =
  | { kind: "loading" }
  | { kind: "hidden" }
  | { kind: "error"; message: string }
  | {
      kind: "own";
      /** `null` while the item is not listed, so no one else can reserve it. */
      mode: ExchangeMode | null;
      location: ItemLocationResponse | null;
      contexts: ItemContextOptionResponse[];
      visibility: ItemActionsResponse["visibility"];
      partyReservation: ItemPartyReservationResponse | null;
    }
  | { kind: "anonymous"; owner: Owner; mode: ExchangeMode; contexts: ItemContextOptionResponse[] }
  | {
      kind: "reserved";
      owner: Owner;
      reservation: ItemActionsResponse["reservation"];
      /** `null` for a viewer outside the reservation. */
      partyReservation: ItemPartyReservationResponse | null;
      location: ItemLocationResponse | null;
    }
  | { kind: "unavailable"; owner: Owner }
  | {
      kind: "choose";
      owner: Owner;
      mode: ExchangeMode;
      location: ItemLocationResponse | null;
      contexts: ItemContextOptionResponse[];
      eligibleContexts: ItemContextOptionResponse[];
      personalPickup: boolean;
    };

interface ItemActionsState {
  /** `null` until the details arrive (or when they failed). */
  item: { deleted: boolean; isOwner: boolean } | null;
  detailsLoading: boolean;
  actions: ItemActionsResponse | null;
  actionsLoading: boolean;
  actionsFetching: boolean;
  actionsError: string | null;
  isLoggedIn: boolean;
}

/** First match wins. Cached actions read for the other side of a
 * login/logout count as loading while they refetch; a failed refresh with
 * cached data keeps the last view. Every non-owner viewer of a reserved item
 * (or one with a pending swap proposal) sees `reserved`, a party with its
 * `partyReservation`. */
export function resolveItemActionsView({
  item,
  detailsLoading,
  actions,
  actionsLoading,
  actionsFetching,
  actionsError,
  isLoggedIn,
}: ItemActionsState): ItemActionsView {
  const otherSession = actions !== null && (actions.viewer === "ANONYMOUS") === isLoggedIn;
  if ((item === null && detailsLoading) || (actions === null && actionsLoading) || (otherSession && actionsFetching)) {
    return { kind: "loading" };
  }
  if (item === null || item.deleted) return { kind: "hidden" };
  if (actions === null) {
    return actionsError ? { kind: "error", message: actionsError } : { kind: "loading" };
  }
  const { owner, mode, location, contexts } = actions;
  if (actions.viewer === "OWN" || item.isOwner) {
    return {
      kind: "own",
      mode,
      location,
      contexts,
      visibility: actions.visibility,
      partyReservation: actions.party_reservation,
    };
  }
  if (actions.party_reservation !== null || actions.reservation !== null) {
    return {
      kind: "reserved",
      owner,
      reservation: actions.reservation,
      partyReservation: actions.party_reservation,
      location,
    };
  }
  if (!actions.available || mode === null) return { kind: "unavailable", owner };
  if (actions.viewer === "ANONYMOUS") return { kind: "anonymous", owner, mode, contexts };
  return {
    kind: "choose",
    owner,
    mode,
    location,
    contexts,
    eligibleContexts: contexts.filter((context) => context.eligible && !context.has_started),
    personalPickup: actions.personal_pickup_available,
  };
}
