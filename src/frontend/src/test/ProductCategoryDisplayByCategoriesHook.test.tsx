import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../theme";
import * as productsApi from "../api/products";
import type { ProductResponse } from "../api/products";
import * as categoriesApi from "../api/categories";
import type { Category } from "../api/categories";
import { ProductDetailPage } from "../pages/ProductDetailPage";

vi.mock("../api/products", () => ({
  getProduct: vi.fn(),
  getProducts: vi.fn(),
}));

vi.mock("../api/categories", () => ({
  getCategories: vi.fn(),
  deleteCategory: vi.fn(),
  moveCategory: vi.fn(),
}));

vi.mock("../plugins/PluginContext", () => ({
  usePluginContext: vi.fn(() => ({
    getProductDetailTabs: () => [],
    getProductDetailInfo: () => [],
  })),
  PluginProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const mockCategories: Category[] = [
  {
    id: 42,
    name: "Elektronika",
    description: null,
    sortOrder: 0,
    productCount: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];

const mockProduct: ProductResponse = {
  id: 1,
  name: "Słuchawki",
  description: null,
  photoUrl: null,
  sku: "SKU-1",
  category_id: 42,
  pluginData: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("Category display resolves via useCategories(), not CATEGORY_LABELS", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(categoriesApi.getCategories).mockResolvedValue(mockCategories);
  });

  it("ProductDetailPage shows the category name looked up by category_id", async () => {
    vi.mocked(productsApi.getProduct).mockResolvedValue(mockProduct);

    render(
      <ChakraProvider value={system}>
        <MemoryRouter initialEntries={["/products/1"]}>
          <Routes>
            <Route path="/products/:id" element={<ProductDetailPage />} />
          </Routes>
        </MemoryRouter>
      </ChakraProvider>,
    );

    expect(await screen.findByText("Elektronika")).toBeInTheDocument();
  });
});
