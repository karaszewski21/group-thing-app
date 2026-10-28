import { useEffect, useRef } from "react";
import type { MessageHandlerOptions } from "./PluginMessageHandler";
import { createMessageHandler } from "./PluginMessageHandler";
import { iframeRegistry } from "./iframeRegistry";

/** Installs the plugin postMessage handler while the caller is mounted. The
 * listener is added once; it always calls the latest `options`. */
export function usePluginMessageHandler(options: MessageHandlerOptions): void {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    const handler = createMessageHandler(iframeRegistry, {
      onFilterChange: (pluginId, payload) => optionsRef.current.onFilterChange?.(pluginId, payload),
      onDone: (pluginId, payload) => optionsRef.current.onDone?.(pluginId, payload),
    });
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);
}
