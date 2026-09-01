import type { PluginContext } from "./types";

function parseContextString(raw: string): PluginContext {
  const jsonStart = raw.indexOf("{");
  if (jsonStart === -1) {
    throw new Error("Invalid context: no JSON metadata found");
  }

  const extensionPoint = raw.substring(0, jsonStart);
  const jsonStr = raw.substring(jsonStart);
  const metadata = JSON.parse(jsonStr) as {
    pluginId: string;
    pluginName: string;
    hostOrigin: string;
    productId?: string;
  };

  return {
    extensionPoint,
    pluginId: metadata.pluginId,
    pluginName: metadata.pluginName,
    hostOrigin: metadata.hostOrigin,
    productId: metadata.productId,
  };
}

/**
 * Parses plugin context from window.name or URL hash fragment (fallback).
 * Format: "PREFIX{json}" where PREFIX is everything before the first "{".
 */
export function parseContext(windowName: string): PluginContext {
  // Try window.name first
  if (windowName && windowName.indexOf("{") !== -1) {
    return parseContextString(windowName);
  }

  // Fallback: read from URL hash (set by PluginFrame as backup)
  const hash = window.location?.hash;
  if (hash) {
    const decoded = decodeURIComponent(hash.substring(1));
    if (decoded.indexOf("{") !== -1) {
      return parseContextString(decoded);
    }
  }

  throw new Error("Invalid context: no JSON metadata found in window.name or URL hash");
}
