import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ItemQuickAddForm } from "../components/shared/ItemQuickAddForm";
import { createEmptyItemQuickAddValue } from "../utils/itemQuickAdd";
import { CONDITION_LABELS } from "../utils/productCategory";
import * as categoriesApi from "../api/categories";

vi.mock("../api/categories", () => ({
  getCategories: vi.fn(),
}));

const mockCategories: categoriesApi.Category[] = [
  { id: 1, name: "Zabawka", description: null, sortOrder: 1, productCount: 0, createdAt: "", updatedAt: "" },
  { id: 2, name: "Książka", description: null, sortOrder: 2, productCount: 0, createdAt: "", updatedAt: "" },
  { id: 3, name: "Gra", description: null, sortOrder: 3, productCount: 0, createdAt: "", updatedAt: "" },
  { id: 4, name: "Ubranie", description: null, sortOrder: 4, productCount: 0, createdAt: "", updatedAt: "" },
  { id: 5, name: "Inne", description: null, sortOrder: 5, productCount: 0, createdAt: "", updatedAt: "" },
];

describe("ItemQuickAddForm", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(categoriesApi.getCategories).mockResolvedValue(mockCategories);
  });

  it("renders exactly 3 fields (name input, condition select, type select) with no product dropdown", async () => {
    render(<ItemQuickAddForm value={createEmptyItemQuickAddValue()} onChange={vi.fn()} />);

    expect(screen.getByLabelText("Nazwa")).toBeInTheDocument();
    expect(screen.getByLabelText("Stan")).toBeInTheDocument();
    expect(screen.getByLabelText("Typ")).toBeInTheDocument();

    // no catalog/product picker dropdown ("+ inny przedmiot" option is the ProductPicker marker)
    expect(screen.queryByText("+ inny przedmiot")).not.toBeInTheDocument();

    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
    await screen.findByText("Zabawka"); // wait for the async useCategories() fetch to settle
  });

  it("`Stan` select options match CONDITION_LABELS", async () => {
    render(<ItemQuickAddForm value={createEmptyItemQuickAddValue()} onChange={vi.fn()} />);
    const select = screen.getByLabelText("Stan") as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels).toEqual(Object.values(CONDITION_LABELS));
    await screen.findByText("Zabawka"); // wait for the async useCategories() fetch to settle
  });

  it("`Typ` select options match useCategories()'s fetched data", async () => {
    render(<ItemQuickAddForm value={createEmptyItemQuickAddValue()} onChange={vi.fn()} />);
    const select = screen.getByLabelText("Typ") as HTMLSelectElement;
    await screen.findByText("Zabawka");
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels).toEqual(mockCategories.map((c) => c.name));
  });

  it("calls onChange with updated {name, condition, category_id} when fields are edited", async () => {
    const onChange = vi.fn();
    render(<ItemQuickAddForm value={createEmptyItemQuickAddValue()} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Nazwa"), { target: { value: "Rowerek" } });

    expect(onChange).toHaveBeenCalledWith({
      name: "Rowerek",
      condition: "GOOD",
      category_id: 0,
    });
    await screen.findByText("Zabawka"); // wait for the async useCategories() fetch to settle
  });

  it("disables the name input and selects when `disabled` is true", async () => {
    render(
      <ItemQuickAddForm value={createEmptyItemQuickAddValue()} onChange={vi.fn()} disabled />,
    );
    expect(screen.getByLabelText("Nazwa")).toBeDisabled();
    expect(screen.getByLabelText("Stan")).toBeDisabled();
    expect(screen.getByLabelText("Typ")).toBeDisabled();
    await screen.findByText("Zabawka"); // wait for the async useCategories() fetch to settle
  });
});
