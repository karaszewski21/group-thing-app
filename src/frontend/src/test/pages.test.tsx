import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../theme";
import type { ProductResponse } from "../api/products";
import * as productsApi from "../api/products";
import { PluginProvider } from "../plugins/PluginContext";
import * as pluginsApi from "../api/plugins";

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

// Mock the API modules
vi.mock("../api/products", () => ({
  getProducts: vi.fn(),
  getProduct: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  deleteProduct: vi.fn(),
}));

vi.mock("../api/plugins", () => ({
  getPlugins: vi.fn().mockResolvedValue([]),
  getPlugin: vi.fn(),
  uploadManifest: vi.fn(),
  deletePlugin: vi.fn(),
  setPluginEnabled: vi.fn(),
}));

const mockProducts: ProductResponse[] = [
  {
    id: 1,
    name: "Wireless Headphones Pro",
    description: "Premium wireless headphones",
    photoUrl: "https://example.com/headphones.jpg",
    price: 149.99,
    sku: "WHP-001",
    category: "TOY",
    pluginData: null,
    createdAt: "2026-03-28T10:00:00Z",
    updatedAt: "2026-03-28T10:00:00Z",
  },
  {
    id: 2,
    name: "Classic Watch",
    description: "Analog watch",
    photoUrl: null,
    price: 89.50,
    sku: "CAW-042",
    category: "CLOTHING",
    pluginData: null,
    createdAt: "2026-03-27T10:00:00Z",
    updatedAt: "2026-03-27T10:00:00Z",
  },
];

function renderWithProviders(ui: React.ReactElement, initialRoute = "/") {
  return render(
    <ChakraProvider value={system}>
      <PluginProvider>
        <MemoryRouter initialEntries={[initialRoute]}>{ui}</MemoryRouter>
      </PluginProvider>
    </ChakraProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(pluginsApi.getPlugins).mockResolvedValue([]);
  vi.mocked(productsApi.getProducts).mockResolvedValue(mockProducts);
  vi.mocked(productsApi.getProduct).mockResolvedValue(mockProducts[0]!);
});

describe("ProductListPage", () => {
  it("renders table with product data and filter controls", async () => {
    const { ProductListPage } = await import("../pages/ProductListPage");
    renderWithProviders(<ProductListPage />);

    expect(await screen.findByText("Wireless Headphones Pro")).toBeInTheDocument();
    expect(screen.getByText("Classic Watch")).toBeInTheDocument();
    expect(screen.getByText("WHP-001")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });
});

describe("ProductFormPage", () => {
  it("renders form fields for product creation", async () => {
    const { ProductFormPage } = await import("../pages/ProductFormPage");
    renderWithProviders(<ProductFormPage />, "/products/new");

    expect(await screen.findByLabelText(/product name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/sku/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/price/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/category/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/photo url/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
  });
});
