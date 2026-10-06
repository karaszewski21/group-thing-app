import { api } from "./client";
import type { ProductResponse } from "./products";
import type { ReservationType } from "./reservations";

export type InventoryType = "PERSONAL" | "PICKUP_POINT" | "VIRTUAL";
export type ItemCondition = "NEW" | "LIKE_NEW" | "GOOD" | "FAIR" | "POOR";
export type BalanceStatus = "AVAILABLE" | "RESERVED" | "IN_TRANSIT" | "LENT" | "RETURNED";

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
  added_at: string;
  created_at: string;
  updated_at: string;
}

/** One of the caller's items physically in their PERSONAL inventory with
 * its standing lend/gift/swap mode — `null` when not offered. Lent-out
 * items are listed by `getMyLentOutItems` instead. */
export interface MyInventoryItemResponse extends InventoryItemResponse {
  listing_mode: ReservationType | null;
  /** True while any photo of the item's product is still in moderation
   * (PENDING or NEEDS_REVIEW). The server then rejects setting a mode
   * with 409, so the panel disables the mode toggles. */
  photos_moderation_pending: boolean;
}

/** One of the caller's items currently lent out — sitting in the
 * borrower's VIRTUAL inventory — with the borrower and the return date. */
export interface LentOutItemResponse {
  id: string;
  product_id: string;
  product_name: string;
  condition: ItemCondition;
  lent_to_display_name: string;
  lent_due_date: string | null;
}

export interface CreateInventoryItemRequest {
  inventory_id: string;
  product_id: string;
  condition: ItemCondition;
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
  // `status`, `null` otherwise. Backs RzeczyView's "Odebrał"/"Anuluj
  // wymianę" fallback buttons (bug #4c).
  reservation_id: string | null;
}

export function getInventories(ownerUserId?: string): Promise<InventoryResponse[]> {
  const query = ownerUserId ? `?owner_user_id=${ownerUserId}` : "";
  return api.get(`/inventories${query}`);
}

export function getInventory(id: string): Promise<InventoryResponse> {
  return api.get(`/inventories/${id}`);
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

export function getInventoryItems(inventoryId: string): Promise<InventoryItemResponse[]> {
  return api.get(`/inventory-items?inventory_id=${inventoryId}`);
}

/** "Moje rzeczy": only items the logged-in user currently owns — an item
 * given or swapped away drops out, one received shows up with no mode. */
export function getMyInventoryItems(): Promise<MyInventoryItemResponse[]> {
  return api.get("/inventory-items/mine");
}

export function getMyLentOutItems(): Promise<LentOutItemResponse[]> {
  return api.get("/inventory-items/mine/lent-out");
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
 * `RzeczyView` to render a passive status badge; see that file for the
 * per-status label mapping. Deliberately excludes `LENT`/`RETURNED` — an
 * already-lent item isn't "pending", it's a settled state with its own
 * "Wypożyczone" view. */
export const ACTIVE_LOCK_BALANCE_STATUSES: readonly BalanceStatus[] = ["RESERVED", "IN_TRANSIT"];

/** One bounded fan-out over the existing single-item balance endpoint,
 * keyed by item id — there is no bulk `/inventory-items/balances` route on
 * the backend (out of scope to add one here), so this is the narrowest
 * "not looped one-call-at-a-time inside the render path" shape available:
 * a single `Promise.all` round-trip the caller awaits once, per
 * `standards/backend/queries.md`'s N+1 principle applied to this
 * component's own data-fetching. */
export interface ItemBalanceSummary {
  status: BalanceStatus;
  reservationId: string | null;
}

export async function getInventoryItemBalances(
  itemIds: string[],
): Promise<Record<string, ItemBalanceSummary>> {
  const balances = await Promise.all(itemIds.map((id) => getInventoryItemBalance(id)));
  return Object.fromEntries(
    balances.map((b) => [b.item_id, { status: b.status, reservationId: b.reservation_id }]),
  );
}

export interface UpdateInventoryItemRequest {
  condition?: ItemCondition;
  product_id?: ProductResponse["id"];
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
