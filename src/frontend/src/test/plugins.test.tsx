import { render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../theme";
import * as pluginsApi from "../api/plugins";
import type { PluginResponse } from "../api/plugins";
import { ADD_EVENT, MENU_MAIN, PRODUCT_DETAIL_TABS, PRODUCT_LIST_FILTERS } from "../plugins/extensionPoints";
import { iframeRegistry } from "../plugins/iframeRegistry";
import { ApiError } from "../api/client";
import { createQueryWrapper } from "./queryClient";

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
        contextData={{ productId: "42" }}
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
    expect(json.productId).toBe("42");
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

const BANNER_URL = "/api/events/3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b/banner";
const EVENTS_PLUGIN_URL = "http://localhost:3004";

interface PluginWindowHarness {
  source: Window;
  postMessage: ReturnType<typeof vi.fn>;
  dispose: () => void;
}

function mountPluginWindow(): PluginWindowHarness {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  const source = iframe.contentWindow;
  if (!source) throw new Error("iframe has no contentWindow");
  const postMessage = vi.fn();
  Object.defineProperty(source, "postMessage", { value: postMessage, writable: true });
  iframeRegistry.register(iframe, { pluginId: "events", pluginUrl: EVENTS_PLUGIN_URL });
  return {
    source,
    postMessage,
    dispose: () => {
      iframeRegistry.unregister(iframe);
      document.body.removeChild(iframe);
    },
  };
}

function pluginMessage(source: Window, type: string, payload: Record<string, unknown>): MessageEvent {
  return new MessageEvent("message", {
    data: { requestId: "aj.plugin.ev1", type, payload },
    origin: EVENTS_PLUGIN_URL,
    source,
  });
}

function imageFile(type: string, size = 16): File {
  return new File([new Uint8Array(size)], "banner", { type });
}

describe("PluginMessageHandler uploadImage", () => {
  afterEach(() => {
    localStorage.removeItem("auth_token");
  });

  it("posts the file as FormData with the token and returns the pluginFetch shape", async () => {
    const { createMessageHandler } = await import("../plugins/PluginMessageHandler");
    const harness = mountPluginWindow();
    localStorage.setItem("auth_token", "test-token");
    const responseBody = JSON.stringify({ url: "https://cdn.example/x.webp", status: "APPROVED" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(responseBody, {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Internal": "hidden" },
      }),
    );

    createMessageHandler(iframeRegistry)(
      pluginMessage(harness.source, "uploadImage", { url: BANNER_URL, file: imageFile("image/png") }),
    );

    await waitFor(() => expect(harness.postMessage).toHaveBeenCalled());
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [calledUrl, init] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe(BANNER_URL);
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("omit");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer test-token");
    expect(headers.get("X-Requested-With")).toBe("PluginFetch");
    expect(headers.has("Content-Type")).toBe(false);
    const body = init?.body;
    if (!(body instanceof FormData)) throw new Error("body is not FormData");
    expect([...body.keys()]).toEqual(["file"]);
    expect(body.get("file")).toBeInstanceOf(Blob);

    const [response, targetOrigin] = harness.postMessage.mock.calls[0];
    expect(targetOrigin).toBe(EVENTS_PLUGIN_URL);
    expect(response).toEqual({
      responseId: "aj.plugin.ev1",
      payload: { status: 200, headers: { "content-type": "application/json" }, body: responseBody },
    });

    fetchSpy.mockRestore();
    harness.dispose();
  });

  it.each([
    ["a path outside the allowlist", "/api/products/1/photos"],
    ["a path with traversal", "/api/events/3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b/../banner"],
    ["a non-uuid event id", "/api/events/abc/banner"],
    ["a non-string url", 42],
  ])("rejects %s", async (_label, url) => {
    const { createMessageHandler } = await import("../plugins/PluginMessageHandler");
    const harness = mountPluginWindow();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    createMessageHandler(iframeRegistry)(
      pluginMessage(harness.source, "uploadImage", { url, file: imageFile("image/png") }),
    );

    await waitFor(() => expect(harness.postMessage).toHaveBeenCalled());
    const [response] = harness.postMessage.mock.calls[0];
    expect(response.responseId).toBe("aj.plugin.ev1");
    expect(response.payload).toBeNull();
    expect(typeof response.error).toBe("string");
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
    harness.dispose();
  });

  it.each([
    ["a non-Blob file", "not a file"],
    ["a file over 5 MB", imageFile("image/jpeg", 5 * 1024 * 1024 + 1)],
    ["a disallowed MIME type", imageFile("image/gif")],
  ])("rejects %s", async (_label, file) => {
    const { createMessageHandler } = await import("../plugins/PluginMessageHandler");
    const harness = mountPluginWindow();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    createMessageHandler(iframeRegistry)(pluginMessage(harness.source, "uploadImage", { url: BANNER_URL, file }));

    await waitFor(() => expect(harness.postMessage).toHaveBeenCalled());
    const [response] = harness.postMessage.mock.calls[0];
    expect(response.payload).toBeNull();
    expect(typeof response.error).toBe("string");
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
    harness.dispose();
  });
});

describe("PluginMessageHandler uploadImage failures", () => {
  it("answers with an error when the upload request itself fails", async () => {
    const { createMessageHandler } = await import("../plugins/PluginMessageHandler");
    const harness = mountPluginWindow();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    createMessageHandler(iframeRegistry)(
      pluginMessage(harness.source, "uploadImage", { url: BANNER_URL, file: imageFile("image/webp") }),
    );

    await waitFor(() => expect(harness.postMessage).toHaveBeenCalled());
    const [response, targetOrigin] = harness.postMessage.mock.calls[0];
    expect(targetOrigin).toBe(EVENTS_PLUGIN_URL);
    expect(response).toEqual({ responseId: "aj.plugin.ev1", payload: null, error: "Failed to fetch" });

    fetchSpy.mockRestore();
    harness.dispose();
  });
});

describe("PluginMessageHandler done", () => {
  it("ignores done from an origin other than the plugin's", async () => {
    const { createMessageHandler } = await import("../plugins/PluginMessageHandler");
    const harness = mountPluginWindow();
    const onDone = vi.fn();

    createMessageHandler(iframeRegistry, { onDone })(
      new MessageEvent("message", {
        data: { requestId: "aj.plugin.ev1", type: "done", payload: { name: "Piknik" } },
        origin: "http://evil.example",
        source: harness.source,
      }),
    );

    expect(onDone).not.toHaveBeenCalled();
    expect(harness.postMessage).not.toHaveBeenCalled();

    harness.dispose();
  });

  it("calls onDone with the plugin id and payload and sends no response", async () => {
    const { createMessageHandler } = await import("../plugins/PluginMessageHandler");
    const harness = mountPluginWindow();
    const onDone = vi.fn();

    createMessageHandler(iframeRegistry, { onDone })(
      pluginMessage(harness.source, "done", { name: "Piknik w parku" }),
    );

    expect(onDone).toHaveBeenCalledWith("events", { name: "Piknik w parku" });
    await new Promise((r) => setTimeout(r, 50));
    expect(harness.postMessage).not.toHaveBeenCalled();

    harness.dispose();
  });

  it.each<[string, unknown]>([
    ["missing", undefined],
    ["null", null],
    ["a string", "Piknik"],
  ])("calls onDone with {} when the payload is %s, without throwing", async (_label, payload) => {
    const { createMessageHandler } = await import("../plugins/PluginMessageHandler");
    const harness = mountPluginWindow();
    const onDone = vi.fn();
    const handler = createMessageHandler(iframeRegistry, { onDone });

    expect(() =>
      handler(
        new MessageEvent("message", {
          data: { requestId: "aj.plugin.ev1", type: "done", payload },
          origin: EVENTS_PLUGIN_URL,
          source: harness.source,
        }),
      ),
    ).not.toThrow();
    expect(onDone).toHaveBeenCalledWith("events", {});

    harness.dispose();
  });

  it("is ignored without onDone: no response and no throw", async () => {
    const { createMessageHandler } = await import("../plugins/PluginMessageHandler");
    const harness = mountPluginWindow();
    const handler = createMessageHandler(iframeRegistry);

    expect(() => handler(pluginMessage(harness.source, "done", { name: "Piknik" }))).not.toThrow();
    await new Promise((r) => setTimeout(r, 50));
    expect(harness.postMessage).not.toHaveBeenCalled();

    harness.dispose();
  });
});

describe("PluginFrame add.event", () => {
  it("uses the RENDER prefix and the given title", async () => {
    const { PluginFrame } = await import("../plugins/PluginFrame");

    renderWithProviders(
      <PluginFrame
        pluginId="events"
        pluginName="Wydarzenia"
        pluginUrl={EVENTS_PLUGIN_URL}
        contextType={ADD_EVENT}
        path="/"
        title="Formularz nowego wydarzenia"
      />,
    );

    const iframe = screen.getByTitle("Formularz nowego wydarzenia");
    if (!(iframe instanceof HTMLIFrameElement)) throw new Error("not an iframe");
    expect(iframe.name).toMatch(/^RENDER\{/);
  });
});

describe("usePluginMessageHandler", () => {
  it("installs one message listener on mount and removes it on unmount", async () => {
    const { usePluginMessageHandler } = await import("../plugins/usePluginMessageHandler");
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    type Props = { onDone: (pluginId: string, payload: Record<string, unknown>) => void };
    const initialProps: Props = { onDone: vi.fn() };
    const { rerender, unmount } = renderHook((props: Props) => usePluginMessageHandler(props), { initialProps });
    rerender({ onDone: vi.fn() });

    const added = addSpy.mock.calls.filter(([type]) => type === "message");
    expect(added).toHaveLength(1);
    unmount();
    const removed = removeSpy.mock.calls.filter(([type]) => type === "message");
    expect(removed).toHaveLength(1);
    expect(removed[0][1]).toBe(added[0][1]);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});

describe("usePlugins", () => {
  it("maps a failed fetch to a message with a stable empty list", async () => {
    const { usePlugins } = await import("../hooks/usePlugins");
    vi.mocked(pluginsApi.getPlugins).mockRejectedValue(
      new ApiError(500, "Internal Server Error", { message: "Błąd serwera" }),
    );

    const { result, rerender } = renderHook(() => usePlugins(), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Błąd serwera");
    const empty = result.current.data;
    expect(empty).toEqual([]);
    rerender();
    expect(result.current.data).toBe(empty);
  });
});
