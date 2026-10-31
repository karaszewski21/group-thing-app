import { api } from "./client";
import type { ItemContextResponse } from "./eventItems";
import type { ExchangeMode } from "./groups";
import type { OwnerNearestDate } from "./ownerItems";
import type { ItemContext } from "../pages/product/useItemRoutes";

/** Who is looking, decided server-side; `?term=`/`?event=` are only hints. */
export type ItemActionsViewer = "ANONYMOUS" | "OWN" | "ELIGIBLE" | "NOT_ELIGIBLE";

/** Mirrors `app.groups.schemas.ItemActionsResponse`. */
export interface ItemActionsResponse {
  /** `null` without a listing preference. */
  mode: ExchangeMode | null;
  /** ACTIVE and AVAILABLE. */
  available: boolean;
  owner: {
    party_id: string;
    display_name: string;
    /** The owner's Organization slug, or `null` without one. */
    slug: string | null;
    items_total: number;
  };
  /** `null` when the context is unknown, the owner is not eligible in it or
   * it is private to the viewer. A started context still comes back, with
   * `has_started`. */
  context: ItemContextResponse | null;
  viewer: ItemActionsViewer;
  nearest: OwnerNearestDate | null;
}

/** The item page's actions in an optional term or event context (public). */
export function getItemActions(itemId: string, context: ItemContext | null): Promise<ItemActionsResponse> {
  const query = context ? `?${new URLSearchParams({ [context.kind]: context.id })}` : "";
  return api.get(`/items/${encodeURIComponent(itemId)}/actions${query}`);
}
