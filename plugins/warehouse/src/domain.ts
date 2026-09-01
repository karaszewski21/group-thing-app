import type { PluginObject } from "../../sdk";

export interface Warehouse {
  objectId: string;
  name: string;
  address: string;
}

export interface StockEntry {
  objectId: string;
  productId: string;
  warehouseId: string;
  quantity: number;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  price: number;
}

export function toWarehouse(obj: PluginObject): Warehouse {
  return { objectId: obj.objectId, name: obj.data.name as string, address: obj.data.address as string };
}

export function toStockEntry(obj: PluginObject): StockEntry {
  return {
    objectId: obj.objectId,
    productId: String(obj.data.productId),
    warehouseId: obj.data.warehouseId as string,
    quantity: obj.data.quantity as number,
  };
}
