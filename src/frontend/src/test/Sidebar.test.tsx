import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../theme";

vi.mock("../auth/AuthContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth/AuthContext")>();
  return {
    ...actual,
    useAuth: vi.fn(),
  };
});

vi.mock("../plugins/PluginContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../plugins/PluginContext")>();
  return {
    ...actual,
    usePluginContext: vi.fn(),
  };
});

import { useAuth } from "../auth/AuthContext";
import { usePluginContext } from "../plugins/PluginContext";
import { Sidebar } from "../components/layout/Sidebar";

function mockAuth(permissions: string[]) {
  vi.mocked(useAuth).mockReturnValue({
    token: "test-token",
    username: "admin",
    displayName: "Admin User",
    permissions,
    registeredRole: null,
    login: vi.fn(),
    register: vi.fn(),
    applyExternalToken: vi.fn(),
    logout: vi.fn(),
  });
}

function mockPlugins(menuItems: Array<{ pluginId: string; pluginName: string; path: string; label?: string; icon?: string }>) {
  vi.mocked(usePluginContext).mockReturnValue({
    plugins: [],
    loading: false,
    error: null,
    refetch: vi.fn(),
    getMenuItems: () =>
      menuItems.map((item) => ({
        ...item,
        type: "menu.main",
        priority: 0,
      })),
    getProductDetailTabs: () => [],
    getProductListFilters: () => [],
    getProductDetailInfo: () => [],
  });
}

function renderSidebar() {
  return render(
    <ChakraProvider value={system}>
      <MemoryRouter initialEntries={["/panel"]}>
        <Sidebar />
      </MemoryRouter>
    </ChakraProvider>,
  );
}

const PLUGIN_MENU_ITEMS = [{ pluginId: "warehouse", pluginName: "Warehouse Management", path: "/", label: "Warehouse" }];

beforeEach(() => {
  vi.resetAllMocks();
  mockPlugins([]);
});

describe("Sidebar ADMIN gating", () => {
  it("shows Categories nav item only for ADMIN principals", () => {
    mockAuth(["ADMIN"]);
    const admin = renderSidebar();
    expect(screen.getByText("Categories")).toBeInTheDocument();
    admin.unmount();

    mockAuth(["PLUGIN_MANAGEMENT"]);
    const pluginOnly = renderSidebar();
    expect(screen.queryByText("Categories")).not.toBeInTheDocument();
    pluginOnly.unmount();

    mockAuth([]);
    const neither = renderSidebar();
    expect(screen.queryByText("Categories")).not.toBeInTheDocument();
    neither.unmount();
  });

  it("shows Plugins NavItem and PluginMenuItems sub-items for PLUGIN_MANAGEMENT-only principal", () => {
    mockAuth(["PLUGIN_MANAGEMENT"]);
    mockPlugins(PLUGIN_MENU_ITEMS);
    renderSidebar();

    expect(screen.getByText("Plugins")).toBeInTheDocument();
    expect(screen.getByText("Warehouse")).toBeInTheDocument();
  });

  it("shows Plugins NavItem and PluginMenuItems sub-items for ADMIN-only principal (known-gap fix)", () => {
    mockAuth(["ADMIN"]);
    mockPlugins(PLUGIN_MENU_ITEMS);
    renderSidebar();

    expect(screen.getByText("Plugins")).toBeInTheDocument();
    expect(screen.getByText("Warehouse")).toBeInTheDocument();
  });

  it("hides Categories, Plugins, and PluginMenuItems sub-items for a principal with neither permission", () => {
    mockAuth([]);
    mockPlugins(PLUGIN_MENU_ITEMS);
    renderSidebar();

    expect(screen.queryByText("Categories")).not.toBeInTheDocument();
    expect(screen.queryByText("Plugins")).not.toBeInTheDocument();
    expect(screen.queryByText("Warehouse")).not.toBeInTheDocument();
  });
});
