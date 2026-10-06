import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../theme";
import type { ProductResponse } from "../api/products";
import * as productsApi from "../api/products";
import { PluginProvider } from "../plugins/PluginContext";
import * as pluginsApi from "../api/plugins";
import * as categoriesApi from "../api/categories";
import { pageOf } from "./page";
import { createQueryWrapper } from "./queryClient";

vi.mock("../auth/AuthContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth/AuthContext")>();
  return {
    ...actual,
    useAuth: vi.fn(() => ({
      token: "test-token",
      username: "admin",
      displayName: "Admin User",
      permissions: ["EDIT", "PLUGIN_MANAGEMENT"],
      login: vi.fn(),
      logout: vi.fn(),
    })),
  };
});

// Mock the API modules
vi.mock("../api/products", () => ({
  getProductsPage: vi.fn(),
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

vi.mock("../api/categories", () => ({
  getCategories: vi.fn(),
}));

const mockCategories: categoriesApi.Category[] = [
  { id: "1", name: "Zabawka", description: null, sortOrder: 1, productCount: 0, createdAt: "", updatedAt: "" },
  { id: "4", name: "Ubranie", description: null, sortOrder: 4, productCount: 0, createdAt: "", updatedAt: "" },
];

const mockProducts: ProductResponse[] = [
  {
    id: "1",
    name: "Wireless Headphones Pro",
    description: "Premium wireless headphones",
    photo_url: "https://example.com/headphones.jpg",
    sku: "WHP-001",
    category_id: "1",
    plugin_data: null,
    created_at: "2026-03-28T10:00:00Z",
    updated_at: "2026-03-28T10:00:00Z",
  },
  {
    id: "2",
    name: "Classic Watch",
    description: "Analog watch",
    photo_url: null,
    sku: "CAW-042",
    category_id: "4",
    plugin_data: null,
    created_at: "2026-03-27T10:00:00Z",
    updated_at: "2026-03-27T10:00:00Z",
  },
];

function renderWithProviders(ui: React.ReactElement, initialRoute = "/") {
  return render(
    <ChakraProvider value={system}>
      <PluginProvider>
        <MemoryRouter initialEntries={[initialRoute]}>{ui}</MemoryRouter>
      </PluginProvider>
    </ChakraProvider>, { wrapper: createQueryWrapper() },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(pluginsApi.getPlugins).mockResolvedValue([]);
  vi.mocked(categoriesApi.getCategories).mockResolvedValue(mockCategories);
  vi.mocked(productsApi.getProductsPage).mockResolvedValue(pageOf(mockProducts));
  vi.mocked(productsApi.getProduct).mockResolvedValue(mockProducts[0]!);
});

describe("ProductListPage", () => {
  it("renders name, description, category and created date with filter controls", async () => {
    const { ProductListPage } = await import("../pages/ProductListPage");
    renderWithProviders(<ProductListPage />);

    expect(await screen.findByText("Wireless Headphones Pro")).toBeInTheDocument();
    expect(screen.getByText("Premium wireless headphones")).toBeInTheDocument();
    expect(await screen.findByText("Zabawka", { selector: "td span" })).toBeInTheDocument();
    expect(screen.getByText("28 mar 2026")).toBeInTheDocument();
    expect(screen.queryByText("Invalid Date")).not.toBeInTheDocument();
    expect(screen.queryByText("WHP-001")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Filter by category" })).toBeInTheDocument();
  });

  it("filters products by the selected category", async () => {
    const { ProductListPage } = await import("../pages/ProductListPage");
    renderWithProviders(<ProductListPage />);
    await screen.findByText("Wireless Headphones Pro");
    await screen.findByRole("option", { name: "Ubranie" });

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by category" }), {
      target: { value: "4" },
    });

    await waitFor(() =>
      expect(productsApi.getProductsPage).toHaveBeenLastCalledWith(
        expect.objectContaining({ category_id: "4" }),
        1,
      ),
    );
  });
});

describe("ProductFormPage", () => {
  it("renders form fields for product creation", async () => {
    const { ProductFormPage } = await import("../pages/ProductFormPage");
    renderWithProviders(<ProductFormPage />, "/admin/products/new");

    expect(await screen.findByLabelText(/product name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/sku/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/category/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/photo url/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
  });
});
