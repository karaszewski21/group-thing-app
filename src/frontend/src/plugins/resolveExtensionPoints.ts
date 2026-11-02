import type { ExtensionPoint, PluginResponse } from "../api/plugins";

export interface ResolvedExtensionPoint extends ExtensionPoint {
  pluginId: string;
  pluginName: string;
  pluginUrl: string;
}

/** Extension points of `type` from enabled plugins, by ascending priority. */
export function resolveExtensionPoints(
  plugins: PluginResponse[],
  type: string,
  pluginId?: string,
): ResolvedExtensionPoint[] {
  const results: ResolvedExtensionPoint[] = [];

  for (const plugin of plugins) {
    if (!plugin.enabled) continue;
    if (pluginId && plugin.id !== pluginId) continue;

    for (const ep of plugin?.extensionPoints ?? []) {
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
