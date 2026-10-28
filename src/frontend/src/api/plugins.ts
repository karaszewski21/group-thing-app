import type { ExtensionPointType } from "../plugins/extensionPoints";
import { api } from "./client";

export interface ExtensionPoint {
  type: ExtensionPointType;
  label?: string;
  icon?: string;
  path?: string;
  priority: number;
  filterKey?: string;
  filterType?: "boolean" | "string" | "number";
}

export interface PluginResponse {
  id: string;
  name: string;
  version: string;
  url: string;
  description: string | null;
  enabled: boolean;
  extensionPoints: ExtensionPoint[];
}

export interface ManifestPayload {
  name: string;
  version: string;
  url: string;
  description?: string;
  extensionPoints?: ExtensionPoint[];
}

/** Wire shape of `app/plugin/schemas.py` `PluginResponse` (snake_case `extension_points`). */
interface PluginWire extends Omit<PluginResponse, "extensionPoints"> {
  extension_points?: ExtensionPoint[];
}

function toPlugin({ extension_points, ...rest }: PluginWire): PluginResponse {
  return { ...rest, extensionPoints: extension_points ?? [] };
}

export async function getPlugins(): Promise<PluginResponse[]> {
  const plugins = await api.get<PluginWire[]>("/plugins");
  return plugins.map(toPlugin);
}

export async function getPlugin(id: string): Promise<PluginResponse> {
  return toPlugin(await api.get<PluginWire>(`/plugins/${id}`));
}

export async function uploadManifest(id: string, manifest: ManifestPayload): Promise<PluginResponse> {
  return toPlugin(await api.put<PluginWire>(`/plugins/${id}/manifest`, manifest));
}

export function deletePlugin(id: string): Promise<void> {
  return api.delete(`/plugins/${id}`);
}

export async function setPluginEnabled(id: string, enabled: boolean): Promise<PluginResponse> {
  return toPlugin(await api.patch<PluginWire>(`/plugins/${id}/enabled`, { enabled }));
}
