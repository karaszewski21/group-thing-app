import { hostApp } from "./host-app";
import { thisPlugin } from "./this-plugin";
import { installResponseListener } from "./messaging";
import { parseContext } from "./context";

// Store hostOrigin on window for hostApp facade to use
let hostOrigin = "*";
try {
  const ctx = parseContext(window.name);
  hostOrigin = ctx.hostOrigin;
  (window as unknown as { __pluginHostOrigin: string }).__pluginHostOrigin = ctx.hostOrigin;
} catch {
  // Context may not be available in non-iframe environments
}

installResponseListener(hostOrigin);

const PluginSDK = { hostApp, thisPlugin };

// Expose on window for IIFE consumption
(window as unknown as { PluginSDK: typeof PluginSDK }).PluginSDK = PluginSDK;

export { hostApp, thisPlugin };
