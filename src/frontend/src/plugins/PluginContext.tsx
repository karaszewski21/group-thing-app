import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ExtensionPoint, PluginResponse } from "../api/plugins";
import { getPlugins } from "../api/plugins";
import { createMessageHandler } from "./PluginMessageHandler";
import { MENU_MAIN, PRODUCT_DETAIL_INFO, PRODUCT_DETAIL_TABS, PRODUCT_LIST_FILTERS } from "./extensionPoints";
import { iframeRegistry } from "./iframeRegistry";

export interface ResolvedExtensionPoint extends ExtensionPoint {
  pluginId: string;
  pluginName: string;
  pluginUrl: string;
}

interface PluginContextValue {
  plugins: PluginResponse[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  getMenuItems: () => ResolvedExtensionPoint[];
  getProductDetailTabs: (pluginId?: string) => ResolvedExtensionPoint[];
  getProductListFilters: () => ResolvedExtensionPoint[];
  getProductDetailInfo: () => ResolvedExtensionPoint[];
}

const PluginContext = createContext<PluginContextValue | null>(null);

function resolveExtensionPoints(plugins: PluginResponse[], type: string, pluginId?: string): ResolvedExtensionPoint[] {
  const results: ResolvedExtensionPoint[] = [];

  for (const plugin of plugins) {
    if (!plugin.enabled) continue;
    if (pluginId && plugin.id !== pluginId) continue;

    for (const ep of plugin.extensionPoints) {
      if (ep.type === type) {
        results.push({
          ...ep,
          pluginId: plugin.id,
          pluginName: plugin.name,
          pluginUrl: plugin.url,
        });
      }
    }
  }

  return results.sort((a, b) => a.priority - b.priority);
}

export function PluginProvider({ children }: { children: ReactNode }) {
  const [plugins, setPlugins] = useState<PluginResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getPlugins();
      setPlugins(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load plugins");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Install the global postMessage handler once
  useEffect(() => {
    const handler = createMessageHandler(iframeRegistry);
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const getMenuItems = useCallback(
    () => resolveExtensionPoints(plugins, MENU_MAIN),
    [plugins],
  );

  const getProductDetailTabs = useCallback(
    (pluginId?: string) => resolveExtensionPoints(plugins, PRODUCT_DETAIL_TABS, pluginId),
    [plugins],
  );

  const getProductListFilters = useCallback(
    () => resolveExtensionPoints(plugins, PRODUCT_LIST_FILTERS),
    [plugins],
  );

  const getProductDetailInfo = useCallback(
    () => resolveExtensionPoints(plugins, PRODUCT_DETAIL_INFO),
    [plugins],
  );

  const value = useMemo<PluginContextValue>(
    () => ({ plugins, loading, error, refetch, getMenuItems, getProductDetailTabs, getProductListFilters, getProductDetailInfo }),
    [plugins, loading, error, refetch, getMenuItems, getProductDetailTabs, getProductListFilters, getProductDetailInfo],
  );

  return <PluginContext value={value}>{children}</PluginContext>;
}

export function usePluginContext(): PluginContextValue {
  const context = useContext(PluginContext);
  if (!context) {
    throw new Error("usePluginContext must be used within a PluginProvider");
  }
  return context;
}
