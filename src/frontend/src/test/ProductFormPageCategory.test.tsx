import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../theme";
import * as productsApi from "../api/products";
import * as categoriesApi from "../api/categories";
import type { Category } from "../api/categories";
import { ProductFormPage } from "../pages/ProductFormPage";

vi.mock("../api/products", () => ({
  getProduct: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
}));

vi.mock("../api/categories", () => ({
  getCategories: vi.fn(),
  deleteCategory: vi.fn(),
  moveCategory: vi.fn(),
}));

const mockCategories: Category[] = [
  {
    id: 5,
    name: "Zabawki",
    description: null,
    sortOrder: 0,
    productCount: 2,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: 7,
    name: "Książki",
    description: null,
    sortOrder: 1,
    productCount: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];

function renderForm() {
  return render(
    <ChakraProvider value={system}>
      <MemoryRouter initialEntries={["/products/new"]}>
        <ProductFormPage />
      </MemoryRouter>
    </ChakraProvider>,
  );
}

describe("ProductFormPage — category data source", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(categoriesApi.getCategories).mockResolvedValue(mockCategories);
    vi.mocked(productsApi.createProduct).mockResolvedValue({
      id: 1,
      name: "Rowerek",
      description: null,
      photoUrl: null,
      price: 10,
      sku: "ABC",
      category_id: 5,
      pluginData: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
  });

  it("renders category <select> options from useCategories()'s live data and submits category_id", async () => {
    renderForm();

    const select = (await screen.findByLabelText(/category/i)) as HTMLSelectElement;
    await waitFor(() => {
      expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
        "Select a category...",
        "Zabawki",
        "Książki",
      ]);
    });

    fireEvent.change(screen.getByLabelText(/product name/i), { target: { value: "Rowerek" } });
    fireEvent.change(screen.getByLabelText(/sku/i), { target: { value: "ABC" } });
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: "10" } });
    fireEvent.change(select, { target: { value: "7" } });

    fireEvent.click(screen.getByRole("button", { name: /save product/i }));

    await waitFor(() => {
      expect(productsApi.createProduct).toHaveBeenCalledWith(
        expect.objectContaining({ category_id: 7 }),
      );
    });
    const payload = vi.mocked(productsApi.createProduct).mock.calls[0]![0];
    expect(payload).not.toHaveProperty("category");
  });
});
