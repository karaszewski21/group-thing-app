import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../theme";
import * as pluginsApi from "../api/plugins";
import type { PluginResponse } from "../api/plugins";
import { MENU_MAIN, PRODUCT_DETAIL_TABS, PRODUCT_LIST_FILTERS } from "../plugins/extensionPoints";

vi.mock("../api/plugins", () => ({
  getPlugins: vi.fn(),
  getPlugin: vi.fn(),
  uploadManifest: vi.fn(),
  deletePlugin: vi.fn(),
  setPluginEnabled: vi.fn(),
}));

const mockPlugins: PluginResponse[] = [
  {
    id: "warehouse",
    name: "Warehouse Management",
    version: "1.0.0",
    url: "http://localhost:3001",
    description: "Manages warehouse inventory",
    enabled: true,
    extensionPoints: [
      { type: MENU_MAIN, label: "Warehouse", path: "/warehouse", priority: 100 },
      { type: PRODUCT_DETAIL_TABS, label: "Stock", path: "/stock", priority: 50 },
      { type: PRODUCT_LIST_FILTERS, path: "/filters", priority: 10 },
    ],
  },
  {
    id: "analytics",
    name: "Analytics Dashboard",
    version: "2.0.0",
    url: "http://localhost:3002",
    description: "Product analytics",
    enabled: true,
    extensionPoints: [
      { type: MENU_MAIN, label: "Analytics", path: "/analytics", priority: 200 },
      { type: PRODUCT_DETAIL_TABS, label: "Insights", path: "/insights", priority: 30 },
    ],
  },
];

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ChakraProvider value={system}>{ui}</ChakraProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(pluginsApi.getPlugins).mockResolvedValue(mockPlugins);
});

describe("PluginContext", () => {
  it("provides plugins after fetch", async () => {
    const { PluginProvider, usePluginContext } = await import("../plugins/PluginContext");

    function TestConsumer() {
      const { plugins, loading } = usePluginContext();
      if (loading) return <div>Loading...</div>;
      return (
        <ul>
          {plugins.map((p) => (
            <li key={p.id}>{p.name}</li>
          ))}
        </ul>
      );
    }

    renderWithProviders(
      <PluginProvider>
        <TestConsumer />
      </PluginProvider>,
    );

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(await screen.findByText("Warehouse Management")).toBeInTheDocument();
    expect(screen.getByText("Analytics Dashboard")).toBeInTheDocument();
    expect(pluginsApi.getPlugins).toHaveBeenCalledOnce();
  });

  it("resolves extension points: getMenuItems, getProductDetailTabs, getProductListFilters", async () => {
    const { PluginProvider, usePluginContext } = await import("../plugins/PluginContext");

    function TestConsumer() {
      const { loading, getMenuItems, getProductDetailTabs, getProductListFilters } = usePluginContext();
      if (loading) return <div>Loading...</div>;
      const menuItems = getMenuItems();
      const tabs = getProductDetailTabs();
      const filters = getProductListFilters();
      return (
        <div>
          <div data-testid="menu-count">{menuItems.length}</div>
          <div data-testid="tabs-count">{tabs.length}</div>
          <div data-testid="filters-count">{filters.length}</div>
          <div data-testid="menu-first">{menuItems[0]?.label}</div>
          <div data-testid="tabs-first">{tabs[0]?.label}</div>
        </div>
      );
    }

    renderWithProviders(
      <PluginProvider>
        <TestConsumer />
      </PluginProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    // Menu items sorted by priority (ascending): warehouse(100) then analytics(200)
    expect(screen.getByTestId("menu-count")).toHaveTextContent("2");
    expect(screen.getByTestId("menu-first")).toHaveTextContent("Warehouse");

    // Tabs sorted by priority: analytics/Insights(30) then warehouse/Stock(50)
    expect(screen.getByTestId("tabs-count")).toHaveTextContent("2");
    expect(screen.getByTestId("tabs-first")).toHaveTextContent("Insights");

    // Only warehouse contributes product.list.filters
    expect(screen.getByTestId("filters-count")).toHaveTextContent("1");
  });
});

describe("PluginFrame", () => {
  it("sets iframe.name correctly for each context type", async () => {
    const { PluginFrame } = await import("../plugins/PluginFrame");

    renderWithProviders(
      <PluginFrame
        pluginId="warehouse"
        pluginName="Warehouse Management"
        pluginUrl="http://localhost:3001"
        contextType={PRODUCT_DETAIL_TABS}
        contextData={{ productId: 42 }}
        path="/stock"
      />,
    );

    const iframe = document.querySelector("iframe");
    expect(iframe).toBeTruthy();

    // The name should contain PRODUCT_DETAIL prefix and JSON with pluginId and productId
    const name = iframe!.name;
    expect(name).toMatch(/^PRODUCT_DETAIL\{/);
    const json = JSON.parse(name.substring(name.indexOf("{")));
    expect(json.pluginId).toBe("warehouse");
    expect(json.pluginName).toBe("Warehouse Management");
    expect(json.productId).toBe(42);
  });
});

describe("PluginMessageHandler", () => {
  it("validates 'aj.plugin.' prefix and rejects invalid requestId", async () => {
    const { createMessageHandler } = await import("../plugins/PluginMessageHandler");

    const mockIframe = document.createElement("iframe");
    const mockRegistry = {
      findBySource: vi.fn().mockReturnValue({ pluginId: "warehouse", pluginUrl: "http://localhost:3001" }),
    };
    const handler = createMessageHandler(mockRegistry as any);

    const event = new MessageEvent("message", {
      data: { requestId: "bad.prefix.123", type: "pluginFetch", payload: {} },
      origin: "http://localhost:3001",
      source: mockIframe.contentWindow,
    });

    handler(event);

    // No response should be sent for invalid prefix — the handler silently ignores it
    // Verify no crash and no unhandled processing
    expect(mockRegistry.findBySource).not.toHaveBeenCalled();
  });

  it("rejects message with invalid origin", async () => {
    const { createMessageHandler } = await import("../plugins/PluginMessageHandler");

    const mockIframe = document.createElement("iframe");
    document.body.appendChild(mockIframe);

    const mockRegistry = {
      findBySource: vi.fn().mockReturnValue({ pluginId: "warehouse", pluginUrl: "http://localhost:3001" }),
    };

    const postMessageSpy = vi.fn();
    Object.defineProperty(mockIframe.contentWindow, "postMessage", {
      value: postMessageSpy,
      writable: true,
    });

    const handler = createMessageHandler(mockRegistry as any);

    // Send message with mismatched origin (evil.com instead of localhost:3001)
    const event = new MessageEvent("message", {
      data: {
        requestId: "aj.plugin.789",
        type: "pluginFetch",
        payload: { url: "/api/products", method: "GET" },
      },
      origin: "http://evil.com",
      source: mockIframe.contentWindow,
    });

    handler(event);

    // Wait a tick to ensure no async processing happens
    await new Promise((r) => setTimeout(r, 50));

    // No response should be sent for mismatched origin
    expect(postMessageSpy).not.toHaveBeenCalled();

    document.body.removeChild(mockIframe);
  });

  it("routes pluginFetch to api client and returns response", async () => {
    const { createMessageHandler } = await import("../plugins/PluginMessageHandler");

    const mockIframe = document.createElement("iframe");
    document.body.appendChild(mockIframe);

    const mockRegistry = {
      findBySource: vi.fn().mockReturnValue({ pluginId: "warehouse", pluginUrl: "http://localhost:3001" }),
    };

    // Mock the global fetch for pluginFetch proxying
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const postMessageSpy = vi.fn();
    // We need to intercept postMessage to the iframe
    Object.defineProperty(mockIframe.contentWindow, "postMessage", {
      value: postMessageSpy,
      writable: true,
    });

    const handler = createMessageHandler(mockRegistry as any);

    const event = new MessageEvent("message", {
      data: {
        requestId: "aj.plugin.123",
        type: "pluginFetch",
        payload: { url: "/api/products", method: "GET" },
      },
      origin: "http://localhost:3001",
      source: mockIframe.contentWindow,
    });

    handler(event);

    await waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalled();
    });

    const response = postMessageSpy.mock.calls[0][0];
    expect(response.responseId).toBe("aj.plugin.123");
    expect(response.payload.status).toBe(200);

    fetchSpy.mockRestore();
    document.body.removeChild(mockIframe);
  });

  it("handles filterChange as fire-and-forget (no response sent)", async () => {
    const { createMessageHandler } = await import("../plugins/PluginMessageHandler");

    const mockIframe = document.createElement("iframe");
    document.body.appendChild(mockIframe);

    const mockRegistry = {
      findBySource: vi.fn().mockReturnValue({ pluginId: "warehouse", pluginUrl: "http://localhost:3001" }),
    };

    const postMessageSpy = vi.fn();
    Object.defineProperty(mockIframe.contentWindow, "postMessage", {
      value: postMessageSpy,
      writable: true,
    });

    const filterChangeCallback = vi.fn();
    const handler = createMessageHandler(mockRegistry as any, { onFilterChange: filterChangeCallback });

    const event = new MessageEvent("message", {
      data: {
        requestId: "aj.plugin.456",
        type: "filterChange",
        payload: { filters: { category: "electronics" } },
      },
      origin: "http://localhost:3001",
      source: mockIframe.contentWindow,
    });

    handler(event);

    // filterChange should call the callback but NOT send a response
    expect(filterChangeCallback).toHaveBeenCalledWith("warehouse", { filters: { category: "electronics" } });

    // Wait a tick to make sure no async postMessage happens
    await new Promise((r) => setTimeout(r, 50));
    expect(postMessageSpy).not.toHaveBeenCalled();

    document.body.removeChild(mockIframe);
  });
});
