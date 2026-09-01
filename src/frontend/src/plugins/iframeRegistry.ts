export interface PluginInfo {
  pluginId: string;
  pluginUrl: string;
}

const registry = new Map<HTMLIFrameElement, PluginInfo>();

export const iframeRegistry = {
  register(iframe: HTMLIFrameElement, info: PluginInfo): void {
    registry.set(iframe, info);
  },

  unregister(iframe: HTMLIFrameElement): void {
    registry.delete(iframe);
  },

  findBySource(source: MessageEventSource | null): PluginInfo | undefined {
    for (const [iframe, info] of registry) {
      if (iframe.contentWindow === source) {
        return info;
      }
    }
    return undefined;
  },
};
