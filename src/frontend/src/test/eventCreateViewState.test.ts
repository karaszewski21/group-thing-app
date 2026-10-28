import { describe, expect, it } from "vitest";
import type { ExtensionPoint, PluginResponse } from "../api/plugins";
import { resolveEventCreateView, type EventCreateView } from "../pages/add/eventCreateViewState";
import { ADD_EVENT, MENU_MAIN } from "../plugins/extensionPoints";
import type { ResolvedExtensionPoint } from "../plugins/resolveExtensionPoints";

function point(overrides: Partial<ExtensionPoint> = {}): ExtensionPoint {
  return { type: ADD_EVENT, label: "Wydarzenie", path: "/", priority: 10, ...overrides };
}

function plugin(overrides: Partial<PluginResponse> = {}): PluginResponse {
  return {
    id: "events",
    name: "Wydarzenia",
    version: "1.0.0",
    url: "http://localhost:3004",
    description: null,
    enabled: true,
    extensionPoints: [point()],
    ...overrides,
  };
}

const READY_POINT: ResolvedExtensionPoint = {
  type: ADD_EVENT,
  label: "Wydarzenie",
  path: "/",
  priority: 10,
  pluginId: "events",
  pluginName: "Wydarzenia",
  pluginUrl: "http://localhost:3004",
};

describe("resolveEventCreateView", () => {
  it.each<[string, { loading: boolean; error: string | null; plugins: PluginResponse[] }, EventCreateView]>([
    ["loading", { loading: true, error: null, plugins: [] }, { kind: "loading" }],
    ["fetch error", { loading: false, error: "Błąd serwera", plugins: [] }, { kind: "unavailable" }],
    ["no plugins", { loading: false, error: null, plugins: [] }, { kind: "unavailable" }],
    ["disabled plugin", { loading: false, error: null, plugins: [plugin({ enabled: false })] }, { kind: "unavailable" }],
    [
      "enabled plugin without add.event",
      { loading: false, error: null, plugins: [plugin({ extensionPoints: [point({ type: MENU_MAIN })] })] },
      { kind: "unavailable" },
    ],
    ["ready", { loading: false, error: null, plugins: [plugin()] }, { kind: "ready", point: READY_POINT }],
    [
      "lowest priority wins",
      {
        loading: false,
        error: null,
        plugins: [
          plugin({ id: "late", name: "Późny", url: "http://localhost:3010", extensionPoints: [point({ priority: 50 })] }),
          plugin(),
        ],
      },
      { kind: "ready", point: READY_POINT },
    ],
  ])("%s", (_label, input, expected) => {
    expect(resolveEventCreateView(input)).toEqual(expected);
  });
});
