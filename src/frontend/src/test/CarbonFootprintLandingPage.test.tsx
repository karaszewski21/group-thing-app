import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../theme";
import { CarbonFootprintLandingPage } from "../pages/CarbonFootprintLandingPage";
import { Sidebar } from "../components/layout/Sidebar";
import * as productsApi from "../api/products";
import type { ProductResponse } from "../api/products";

vi.mock("../api/products", () => ({
  getProducts: vi.fn(),
}));

vi.mock("../auth/AuthContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth/AuthContext")>();
  return {
    ...actual,
    useAuth: vi.fn(() => ({
      token: "test-token",
      username: "admin",
      permissions: ["EDIT", "PLUGIN_MANAGEMENT"],
      login: vi.fn(),
      logout: vi.fn(),
    })),
  };
});

vi.mock("../plugins/PluginContext", async () => {
  return {
    usePluginContext: vi.fn(() => ({
      getMenuItems: () => [],
      loading: false,
    })),
    PluginProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});

const products: ProductResponse[] = [
  {
    id: 11,
    name: "Organic Frozen Berries 500g",
    description: null,
    photoUrl: null,
    price: 9.99,
    sku: "OFB-330",
    category: {
      id: 1,
      name: "Frozen",
      description: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    pluginData: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: 22,
    name: "Berries Premium 250g",
    description: null,
    photoUrl: null,
    price: 6.49,
    sku: "BPR-220",
    category: {
      id: 1,
      name: "Frozen",
      description: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    pluginData: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];

function renderLanding() {
  return render(
    <ChakraProvider value={system}>
      <MemoryRouter initialEntries={["/carbon-footprint"]}>
        <Routes>
          <Route path="/carbon-footprint" element={<CarbonFootprintLandingPage />} />
          <Route
            path="/products/:id/footprint"
            element={<div data-testid="footprint-page">Footprint page</div>}
          />
        </Routes>
      </MemoryRouter>
    </ChakraProvider>,
  );
}

describe("CarbonFootprintLandingPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(productsApi.getProducts).mockResolvedValue(products);
  });

  it("with no search term, renders EmptyState message and does not call getProducts", () => {
    renderLanding();

    expect(
      screen.getByText(/Search a product to see its footprint\./i),
    ).toBeInTheDocument();
    expect(productsApi.getProducts).not.toHaveBeenCalled();
  });

  it("typing a search calls getProducts({ search }) and renders result rows", async () => {
    renderLanding();

    const input = screen.getByPlaceholderText(/search/i);
    await act(async () => {
      fireEvent.change(input, { target: { value: "berries" } });
    });

    await waitFor(
      () => {
        expect(productsApi.getProducts).toHaveBeenCalledWith({ search: "berries" });
      },
      { timeout: 1000 },
    );

    expect(await screen.findByText("Organic Frozen Berries 500g")).toBeInTheDocument();
    expect(screen.getByText("Berries Premium 250g")).toBeInTheDocument();
  });

  it("clicking a result navigates to /products/:id/footprint", async () => {
    const { container } = renderLanding();

    const input = screen.getByPlaceholderText(/search/i);
    await act(async () => {
      fireEvent.change(input, { target: { value: "berries" } });
    });

    await screen.findByText("Organic Frozen Berries 500g");
    const link = container.querySelector('a[href="/products/11/footprint"]');
    expect(link).not.toBeNull();

    await act(async () => {
      fireEvent.click(link as Element);
    });

    expect(await screen.findByTestId("footprint-page")).toBeInTheDocument();
  });
});

describe("Sidebar — Carbon Footprint entry", () => {
  it("renders a Carbon Footprint nav link pointing to /carbon-footprint", () => {
    const { container } = render(
      <ChakraProvider value={system}>
        <MemoryRouter initialEntries={["/"]}>
          <Sidebar />
        </MemoryRouter>
      </ChakraProvider>,
    );

    const link = container.querySelector('a[href="/carbon-footprint"]');
    expect(link).not.toBeNull();
    expect(link).toHaveTextContent(/carbon footprint/i);
  });
});
