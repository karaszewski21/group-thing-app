import type { PluginResponse } from "../../api/plugins";
import { ADD_EVENT } from "../../plugins/extensionPoints";
import type { ResolvedExtensionPoint } from "../../plugins/resolveExtensionPoints";
import { resolveExtensionPoints } from "../../plugins/resolveExtensionPoints";

export type EventCreateView =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "ready"; point: ResolvedExtensionPoint };

interface EventCreateViewInput {
  loading: boolean;
  error: string | null;
  plugins: PluginResponse[];
}

/** The /add/event screen: the first enabled `add.event` plugin by priority,
 * or the fallback when the plugin list failed or nothing provides it. */
export function resolveEventCreateView({ loading, error, plugins }: EventCreateViewInput): EventCreateView {
  if (loading) return { kind: "loading" };
  if (error) return { kind: "unavailable" };
  const point = resolveExtensionPoints(plugins, ADD_EVENT)[0];
  return point ? { kind: "ready", point } : { kind: "unavailable" };
}
