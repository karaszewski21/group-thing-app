import { api } from "./client";

export type InventoryType = "PERSONAL" | "PICKUP_POINT" | "VIRTUAL";
export type ItemCondition = "NEW" | "LIKE_NEW" | "GOOD" | "FAIR" | "POOR";
export type BalanceStatus = "AVAILABLE" | "RESERVED" | "IN_TRANSIT" | "LENT" | "RETURNED";

export interface InventoryResponse {
  id: number;
  owner_user_id: number;
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
  id: number;
  inventory_id: number;
  home_inventory_id: number | null;
  product_id: number;
  product_name: string;
  condition: ItemCondition;
  added_at: string;
  created_at: string;
  updated_at: string;
}

export interface CreateInventoryItemRequest {
  inventory_id: number;
  product_id: number;
  condition: ItemCondition;
}

export interface InventoryBalanceResponse {
  id: number;
  item_id: number;
  status: BalanceStatus;
  reserved_at: string | null;
  lent_at: string | null;
  returned_at: string | null;
  due_date: string | null;
  // The item's in-flight Reservation id — set only for RESERVED/IN_TRANSIT
  // `status`, `null` otherwise. Backs RzeczyView's "Odebrał"/"Anuluj
  // wymianę" fallback buttons (bug #4c).
  reservation_id: number | null;
}

export function getInventories(ownerUserId?: number): Promise<InventoryResponse[]> {
  const query = ownerUserId ? `?owner_user_id=${ownerUserId}` : "";
  return api.get(`/inventories${query}`);
}

export function getInventory(id: number): Promise<InventoryResponse> {
  return api.get(`/inventories/${id}`);
}

export function createInventory(request: CreateInventoryRequest): Promise<InventoryResponse> {
  return api.post("/inventories", request);
}

export function getInventoryItems(inventoryId: number): Promise<InventoryItemResponse[]> {
  return api.get(`/inventory-items?inventory_id=${inventoryId}`);
}

export function getInventoryItem(id: number): Promise<InventoryItemResponse> {
  return api.get(`/inventory-items/${id}`);
}

export function registerInventoryItem(
  request: CreateInventoryItemRequest,
): Promise<InventoryItemResponse> {
  return api.post("/inventory-items", request);
}

export function getInventoryItemBalance(itemId: number): Promise<InventoryBalanceResponse> {
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
  reservationId: number | null;
}

export async function getInventoryItemBalances(
  itemIds: number[],
): Promise<Record<number, ItemBalanceSummary>> {
  const balances = await Promise.all(itemIds.map((id) => getInventoryItemBalance(id)));
  return Object.fromEntries(
    balances.map((b) => [b.item_id, { status: b.status, reservationId: b.reservation_id }]),
  );
}

export interface UpdateInventoryItemRequest {
  condition?: ItemCondition;
  product_id?: number;
}

export function updateInventoryItem(
  id: number,
  request: UpdateInventoryItemRequest,
): Promise<InventoryItemResponse> {
  return api.patch(`/inventory-items/${id}`, request);
}

export function deleteInventoryItem(id: number): Promise<void> {
  return api.delete(`/inventory-items/${id}`);
}
