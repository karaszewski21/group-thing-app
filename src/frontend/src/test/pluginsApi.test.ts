import { afterEach, describe, expect, it, vi } from "vitest";
import { getPlugins } from "../api/plugins";
import { ADD_EVENT } from "../plugins/extensionPoints";
import { resolveExtensionPoints } from "../plugins/resolveExtensionPoints";

/** The exact field set of `app/plugin/schemas.py` `PluginResponse`. */
const backendPlugins = [
  {
    id: "events",
    name: "Wydarzenia",
    version: "1.0.0",
    url: "http://localhost:3004",
    description: null,
    enabled: true,
    extension_points: [{ type: "add.event", label: "Wydarzenie", path: "/", priority: 10 }],
  },
  {
    id: "legacy",
    name: "Legacy",
    version: "0.1.0",
    url: "http://localhost:3009",
    description: "Bez punktów rozszerzeń",
    enabled: true,
  },
];

describe("plugins API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getPlugins_backendSnakeCaseShape_mapsExtensionPointsForResolver", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(backendPlugins), { status: 200 })));

    const plugins = await getPlugins();

    expect(plugins[0].extensionPoints).toEqual(backendPlugins[0].extension_points);
    expect(plugins[0]).not.toHaveProperty("extension_points");
    expect(plugins[1].extensionPoints).toEqual([]);
    const [point] = resolveExtensionPoints(plugins, ADD_EVENT);
    expect(point).toMatchObject({ pluginId: "events", type: ADD_EVENT, path: "/" });
  });
});
