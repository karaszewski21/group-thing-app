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

export function getPlugins(): Promise<PluginResponse[]> {
  return api.get("/plugins");
}

export function getPlugin(id: string): Promise<PluginResponse> {
  return api.get(`/plugins/${id}`);
}

export function uploadManifest(id: string, manifest: ManifestPayload): Promise<PluginResponse> {
  return api.put(`/plugins/${id}/manifest`, manifest);
}

export function deletePlugin(id: string): Promise<void> {
  return api.delete(`/plugins/${id}`);
}

export function setPluginEnabled(id: string, enabled: boolean): Promise<PluginResponse> {
  return api.patch(`/plugins/${id}/enabled`, { enabled });
}
