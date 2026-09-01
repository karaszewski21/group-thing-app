import type { PluginContext, PluginObject } from "./types";
import { parseContext } from "./context";
import { sendMessageAndWait, sendFireAndForget } from "./messaging";

let cachedContext: PluginContext | null = null;

function getHostOrigin(): string {
  return getContext().hostOrigin;
}

function getContext(): PluginContext {
  if (!cachedContext) {
    try {
      cachedContext = parseContext(window.name);
    } catch {
      // Not running inside a host iframe — use stored hostOrigin from index.ts or fallback
      const storedOrigin = (window as unknown as { __pluginHostOrigin?: string }).__pluginHostOrigin;
      cachedContext = {
        extensionPoint: "STANDALONE",
        pluginId: "unknown",
        pluginName: "Standalone",
        hostOrigin: storedOrigin ?? window.location.origin,
      };
    }
  }
  return cachedContext;
}

export const thisPlugin = {
  getContext,

  /** Shortcut for getContext().pluginId */
  get pluginId(): string {
    return getContext().pluginId;
  },

  /** Shortcut for getContext().pluginName */
  get pluginName(): string {
    return getContext().pluginName;
  },

  /** Shortcut for getContext().productId — present only for product-scoped extension points. */
  get productId(): string | undefined {
    return getContext().productId;
  },

  getData(productId: string): Promise<unknown> {
    return sendMessageAndWait("getData", { productId }, getHostOrigin());
  },

  setData(productId: string, data: Record<string, unknown>): Promise<unknown> {
    return sendMessageAndWait("setData", { productId, data }, getHostOrigin());
  },

  removeData(productId: string): Promise<unknown> {
    return sendMessageAndWait("removeData", { productId }, getHostOrigin());
  },

  filterChange(payload: Record<string, unknown>): void {
    sendFireAndForget("filterChange", payload, getHostOrigin());
  },

  objects: {
    list(type: string, options?: { entityType?: string; entityId?: string; filter?: string }): Promise<PluginObject[]> {
      return sendMessageAndWait("objectsList", { objectType: type, ...options }, getHostOrigin()) as Promise<PluginObject[]>;
    },

    listByEntity(entityType: string, entityId: string, options?: { filter?: string }): Promise<PluginObject[]> {
      return sendMessageAndWait("objectsListByEntity", { entityType, entityId, ...options }, getHostOrigin()) as Promise<PluginObject[]>;
    },

    get(type: string, id: string): Promise<PluginObject> {
      return sendMessageAndWait("objectsGet", { objectType: type, objectId: id }, getHostOrigin()) as Promise<PluginObject>;
    },

    save(type: string, id: string, data: Record<string, unknown>, options?: { entityType?: string; entityId?: string }): Promise<PluginObject> {
      return sendMessageAndWait("objectsSave", { objectType: type, objectId: id, data, ...options }, getHostOrigin()) as Promise<PluginObject>;
    },

    delete(type: string, id: string): Promise<unknown> {
      return sendMessageAndWait("objectsDelete", { objectType: type, objectId: id }, getHostOrigin());
    },
  },
};
