import { api } from "./client";
import { pageParams, type Page } from "./pagination";
import type { ItemVisibility, ListingMode } from "./itemListingPreferences";
import type { ProductResponse } from "./products";
import type { ReservationType } from "./reservations";

export type InventoryType = "PERSONAL" | "PICKUP_POINT" | "VIRTUAL";
export type ItemCondition = "NEW" | "LIKE_NEW" | "GOOD" | "FAIR" | "POOR";
export type BalanceStatus = "AVAILABLE" | "RESERVED" | "IN_TRANSIT" | "LENT" | "RETURNED";
/** `DRAFT` until the item is first offered (or after its mode is cleared). */
export type ListingStatus = "DRAFT" | "ACTIVE";

export interface InventoryResponse {
  id: string;
  owner_user_id: string;
  inventory_type: InventoryType;
  location: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateInventoryRequest {
  inventory_type: InventoryType;
  location?: string;
}

export interface InventoryItemResponse {
  id: string;
  inventory_id: string;
  home_inventory_id: string | null;
  product_id: string;
  product_name: string;
  condition: ItemCondition;
  listing_status: ListingStatus;
  added_at: string;
  created_at: string;
  updated_at: string;
}

/** One of the caller's items physically in their PERSONAL inventory with
 * its standing gift/swap mode — `null` when not offered. */
export interface MyInventoryItemResponse extends InventoryItemResponse {
  listing_mode: ReservationType | null;
  /** The listing's visibility; `null` exactly when `listing_mode` is. */
  listing_visibility: ItemVisibility | null;
  /** True while any photo of the item's product is still in moderation
   * (PENDING or NEEDS_REVIEW). The server then rejects setting a mode
   * with 409, so the panel disables the mode toggles. */
  photos_moderation_pending: boolean;
  /** The product's first approved photo (thumbnail), or null without one. */
  thumb_url?: string | null;
  /** The item's place (owner only), or `null` without one. */
  location_id: string | null;
  /** As `GET /inventory-items/{id}/balance` reports them: the item's
   * balance and, while it is RESERVED or IN_TRANSIT, its active reservation. */
  balance_status: BalanceStatus;
  reservation_id: string | null;
}

export interface CreateInventoryItemRequest {
  inventory_id: string;
  product_id: string;
  condition: ItemCondition;
  /** One of the caller's live saved places. */
  location_id: string;
  /** Offers the item right away (`ACTIVE`); null or omitted saves a `DRAFT`. */
  listing_mode?: ListingMode | null;
}

export interface InventoryBalanceResponse {
  id: string;
  item_id: string;
  status: BalanceStatus;
  reserved_at: string | null;
  lent_at: string | null;
  returned_at: string | null;
  due_date: string | null;
  // The item's in-flight Reservation id — set only for RESERVED/IN_TRANSIT
  // `status`, `null` otherwise. Backs MyItemsView's "Odebrał"/"Anuluj
  // wymianę" fallback buttons (bug #4c).
  reservation_id: string | null;
}

export function getInventories(ownerUserId?: string): Promise<InventoryResponse[]> {
  const query = ownerUserId ? `?owner_user_id=${ownerUserId}` : "";
  return api.get(`/inventories${query}`);
}

export function createInventory(request: CreateInventoryRequest): Promise<InventoryResponse> {
  return api.post("/inventories", request);
}

/** The user's PERSONAL inventory, created on first use. */
export async function getOrCreatePersonalInventory(ownerUserId: string): Promise<InventoryResponse> {
  const inventories = await getInventories(ownerUserId);
  const personal = inventories.find((i) => i.inventory_type === "PERSONAL");
  return personal ?? createInventory({ inventory_type: "PERSONAL" });
}

/** "Moje rzeczy": only items the logged-in user currently owns — an item
 * given or swapped away drops out, one received shows up with no mode. */
export function getMyInventoryItems(): Promise<MyInventoryItemResponse[]> {
  return api.get("/inventory-items/mine");
}

/** Per-mode counts over every item at home, ignoring the page filters. */
export interface MyInventoryItemCounts {
  ALL: number;
  GIFT: number;
  SWAP: number;
}

export interface MyInventoryItemsPage extends Page<MyInventoryItemResponse> {
  counts: MyInventoryItemCounts;
}

export type MyItemsModeFilter = "GIFT" | "SWAP";

/** One page of "Moje rzeczy", newest first: `mode` keeps one listing mode,
 * `q` matches part of the name. */
export function getMyInventoryItemsPage(
  { mode, q }: { mode: MyItemsModeFilter | null; q: string },
  page: number,
  size?: number,
): Promise<MyInventoryItemsPage> {
  const params = new URLSearchParams(pageParams(page, size));
  if (mode) params.set("mode", mode);
  if (q) params.set("q", q);
  return api.get(`/inventory-items/mine/page?${params}`);
}

export function getInventoryItem(id: string): Promise<InventoryItemResponse> {
  return api.get(`/inventory-items/${id}`);
}

export function registerInventoryItem(
  request: CreateInventoryItemRequest,
): Promise<InventoryItemResponse> {
  return api.post("/inventory-items", request);
}

export function getInventoryItemBalance(itemId: string): Promise<InventoryBalanceResponse> {
  return api.get(`/inventory-items/${itemId}/balance`);
}

/** `BalanceStatus` values that mean "this item currently has an active
 * lock" — a `Reservation` is in flight (or just resulted from an accepted
 * swap proposal) and the item isn't free for a new action. Used by
 * `MyItemsView` to render a passive status badge; see that file for the
 * per-status label mapping. */
export const ACTIVE_LOCK_BALANCE_STATUSES: readonly BalanceStatus[] = ["RESERVED", "IN_TRANSIT"];


export interface UpdateInventoryItemRequest {
  condition?: ItemCondition;
  product_id?: ProductResponse["id"];
  /** Omitted keeps the place; `null` is rejected (422). */
  location_id?: string;
}

export function updateInventoryItem(
  id: string,
  request: UpdateInventoryItemRequest,
): Promise<InventoryItemResponse> {
  return api.patch(`/inventory-items/${id}`, request);
}

export function deleteInventoryItem(id: string): Promise<void> {
  return api.delete(`/inventory-items/${id}`);
}
