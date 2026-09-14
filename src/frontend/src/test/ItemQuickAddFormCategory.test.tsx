import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ItemQuickAddForm } from "../components/shared/ItemQuickAddForm";
import { createEmptyItemQuickAddValue } from "../utils/itemQuickAdd";
import * as categoriesApi from "../api/categories";
import type { Category } from "../api/categories";
import { resolveProduct } from "../api/products";

vi.mock("../api/categories", () => ({
  getCategories: vi.fn(),
  deleteCategory: vi.fn(),
  moveCategory: vi.fn(),
}));

vi.mock("../api/products", () => ({
  resolveProduct: vi.fn(),
}));

const mockCategories: Category[] = [
  {
    id: 3,
    name: "Zabawki",
    description: null,
    sortOrder: 0,
    productCount: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: 9,
    name: "Ubrania",
    description: null,
    sortOrder: 1,
    productCount: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];

describe("ItemQuickAddForm — category_id rename", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(categoriesApi.getCategories).mockResolvedValue(mockCategories);
  });

  it("renders the Typ select from useCategories()'s live data, keyed by category_id", async () => {
    render(
      <ItemQuickAddForm value={createEmptyItemQuickAddValue(3)} onChange={vi.fn()} />,
    );

    const select = (await screen.findByLabelText("Typ")) as HTMLSelectElement;
    await waitFor(() => {
      expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
        "Zabawki",
        "Ubrania",
      ]);
      expect(Array.from(select.options).map((o) => o.value)).toEqual(["3", "9"]);
    });
  });

  it("selecting a category emits onChange with a numeric category_id, which the caller then resolves via resolveProduct({ name, category_id })", async () => {
    const onChange = vi.fn();
    const value = createEmptyItemQuickAddValue(3);
    render(<ItemQuickAddForm value={{ ...value, name: "Rowerek" }} onChange={onChange} />);

    const select = await screen.findByLabelText("Typ");
    await waitFor(() => expect((select as HTMLSelectElement).options.length).toBe(2));

    fireEvent.change(select, { target: { value: "9" } });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ category_id: 9, name: "Rowerek" }),
    );

    // Simulate the caller (PanelDataContext.handleAddItem) resolving the
    // Product with the emitted category_id.
    const emitted = onChange.mock.calls[0]![0] as { name: string; category_id: number };
    vi.mocked(resolveProduct).mockResolvedValue({
      id: 1,
      name: emitted.name,
      description: null,
      photoUrl: null,
      sku: "SKU",
      category_id: emitted.category_id,
      pluginData: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    await resolveProduct({ name: emitted.name, category_id: emitted.category_id });
    expect(resolveProduct).toHaveBeenCalledWith({ name: "Rowerek", category_id: 9 });
  });
});
