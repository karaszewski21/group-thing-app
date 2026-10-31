import type { ItemContextResponse } from "../../api/eventItems";
import type { ExchangeMode } from "../../api/groups";
import type { ItemActionsResponse } from "../../api/itemActions";
import type { OwnerNearestDate } from "../../api/ownerItems";

type Owner = ItemActionsResponse["owner"];

/** The one state the item page's actions card shows (spec Requirement 16). */
export type ItemActionsView =
  | { kind: "loading" }
  | { kind: "hidden" }
  | { kind: "error"; message: string }
  | { kind: "own"; contextName: string | null }
  | { kind: "unavailable"; owner: Owner }
  | { kind: "noContext"; owner: Owner; nearest: OwnerNearestDate | null }
  | { kind: "stale"; context: ItemContextResponse; owner: Owner; nearest: OwnerNearestDate | null }
  | { kind: "anonymous"; context: ItemContextResponse; mode: ExchangeMode; owner: Owner }
  | { kind: "notSignedUp"; context: ItemContextResponse; owner: Owner }
  | { kind: "eligible"; context: ItemContextResponse; mode: ExchangeMode; owner: Owner };

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

/** First match in the Requirement 16 order. Cached actions read for the
 * other side of a login/logout count as loading while they refetch; a failed
 * refresh with cached data keeps the last view. */
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
  const { owner, context, mode, nearest } = actions;
  if (actions.viewer === "OWN" || item.isOwner) return { kind: "own", contextName: context?.name ?? null };
  if (!actions.available || mode === null) return { kind: "unavailable", owner };
  if (context === null) return { kind: "noContext", owner, nearest };
  if (context.has_started) return { kind: "stale", context, owner, nearest };
  if (actions.viewer === "ANONYMOUS") return { kind: "anonymous", context, mode, owner };
  if (actions.viewer === "NOT_ELIGIBLE") return { kind: "notSignedUp", context, owner };
  return { kind: "eligible", context, mode, owner };
}
