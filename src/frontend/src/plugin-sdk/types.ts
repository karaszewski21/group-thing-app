export interface PluginContext {
  extensionPoint: string;
  pluginId: string;
  pluginName: string;
  hostOrigin: string;
  productId?: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  description: string | null;
  price: number;
  categoryId: string | null;
}

export interface PluginObject {
  id: string;
  pluginId: string;
  objectType: string;
  objectId: string;
  data: Record<string, unknown>;
  entityType?: string;
  entityId?: string;
}
