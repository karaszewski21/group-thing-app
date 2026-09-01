import { useEffect, useRef } from "react";
import type { ExtensionPointType } from "./extensionPoints";
import { MENU_MAIN, PRODUCT_DETAIL_INFO, PRODUCT_DETAIL_TABS, PRODUCT_LIST_FILTERS } from "./extensionPoints";
import { iframeRegistry } from "./iframeRegistry";

interface PluginFrameProps {
  pluginId: string;
  pluginName: string;
  pluginUrl: string;
  contextType: ExtensionPointType;
  contextData?: Record<string, unknown>;
  path: string;
  style?: React.CSSProperties;
}

const CONTEXT_TYPE_PREFIX: Record<ExtensionPointType, string> = {
  [MENU_MAIN]: "RENDER",
  [PRODUCT_DETAIL_TABS]: "PRODUCT_DETAIL",
  [PRODUCT_LIST_FILTERS]: "FILTER",
  [PRODUCT_DETAIL_INFO]: "PRODUCT_DETAIL",
};

function buildContextString(props: PluginFrameProps): string {
  const prefix = CONTEXT_TYPE_PREFIX[props.contextType] ?? "RENDER";
  const contextPayload: Record<string, unknown> = {
    pluginId: props.pluginId,
    pluginName: props.pluginName,
    hostOrigin: window.location.origin,
    ...props.contextData,
  };
  return `${prefix}${JSON.stringify(contextPayload)}`;
}

const SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads";

export function PluginFrame(props: PluginFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    // Only set iframe src once to avoid reloading the plugin
    if (!initializedRef.current) {
      initializedRef.current = true;

      // Set name before src so the plugin can read context on load
      const contextString = buildContextString(props);
      iframe.name = contextString;

      // Also pass context as URL hash fragment (fallback for when window.name is cleared by dev servers)
      const src = new URL(props.path, props.pluginUrl);
      src.hash = encodeURIComponent(contextString);
      iframe.src = src.toString();
    }

    // Always register — must survive StrictMode's cleanup/re-run cycle
    iframeRegistry.register(iframe, {
      pluginId: props.pluginId,
      pluginUrl: props.pluginUrl,
    });

    return () => {
      iframeRegistry.unregister(iframe);
    };
  }, [props.pluginId, props.pluginName, props.pluginUrl, props.contextType, props.path, props.contextData]);

  return (
    <iframe
      ref={iframeRef}
      sandbox={SANDBOX}
      style={{ border: "none", width: "100%", height: "100%", ...props.style }}
      title={`Plugin: ${props.pluginName}`}
    />
  );
}
