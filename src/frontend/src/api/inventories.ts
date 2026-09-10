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
  product_id: number;
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
