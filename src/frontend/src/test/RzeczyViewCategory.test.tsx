import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RzeczyView } from "../pages/panel/views/RzeczyView";
import * as panelDataStore from "../pages/panel/panelDataStore";
import type { PanelDataContextValue } from "../pages/panel/PanelDataContext";
import type { InventoryItemResponse } from "../api/inventories";
import type { Category } from "../api/categories";

vi.mock("../pages/panel/panelDataStore", async () => {
  const actual = await vi.importActual<typeof import("../pages/panel/panelDataStore")>(
    "../pages/panel/panelDataStore",
  );
  return { ...actual, usePanelData: vi.fn() };
});

const mockCategories: Category[] = [
  {
    id: 1,
    name: "Zabawki",
    description: null,
    sortOrder: 0,
    productCount: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: 2,
    name: "Ubrania",
    description: null,
    sortOrder: 1,
    productCount: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];

const item: InventoryItemResponse = {
  id: 10,
  inventory_id: 1,
  product_id: 100,
  condition: "GOOD",
  added_at: "2026-01-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function makeContextValue(
  overrides: Partial<PanelDataContextValue> = {},
): PanelDataContextValue {
  return {
    items: [item],
    itemModes: {},
    editingItemMeta: { id: 10, name: "Rowerek", category_id: 1 },
    editingItemCondition: null,
    itemMetaError: null,
    itemError: null,
    busy: false,
    productName: () => "Rowerek",
    categories: mockCategories,
    setItemDraft: vi.fn(),
    setModal: vi.fn(),
    setEditingItemMeta: vi.fn(),
    setEditingItemCondition: vi.fn(),
    saveItemMeta: vi.fn(),
    saveItemCondition: vi.fn(),
    startEditItemMeta: vi.fn(),
    setItemMode: vi.fn(),
    handleDeleteItem: vi.fn(),
    ...overrides,
  } as unknown as PanelDataContextValue;
}

describe("RzeczyView — category select renders from live category data", () => {
  it("renders the 'Typ rzeczy' select options from useCategories()'s live data (via panel context)", () => {
    vi.mocked(panelDataStore.usePanelData).mockReturnValue(makeContextValue());

    render(<RzeczyView />);

    const select = screen.getByLabelText("Typ rzeczy") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["Zabawki", "Ubrania"]);
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["1", "2"]);
    expect(select.value).toBe("1");
  });
});
