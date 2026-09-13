import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NeededItemQuickAddForm } from "../components/shared/NeededItemQuickAddForm";
import { createEmptyNeededItemQuickAddValue } from "../utils/neededItemQuickAdd";
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

describe("NeededItemQuickAddForm", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(categoriesApi.getCategories).mockResolvedValue(mockCategories);
  });

  it("renders name input, type select, and a description input (no condition)", async () => {
    render(
      <NeededItemQuickAddForm value={createEmptyNeededItemQuickAddValue()} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText("Nazwa")).toBeInTheDocument();
    expect(screen.getByLabelText("Typ")).toBeInTheDocument();
    expect(screen.getByLabelText("Doprecyzowanie (opcjonalnie)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Stan")).not.toBeInTheDocument();

    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    await screen.findByText("Zabawka"); // wait for the async useCategories() fetch to settle
  });

  it("`Typ` options match useCategories()'s fetched data", async () => {
    render(
      <NeededItemQuickAddForm value={createEmptyNeededItemQuickAddValue()} onChange={vi.fn()} />,
    );
    const select = screen.getByLabelText("Typ") as HTMLSelectElement;
    await screen.findByText("Zabawka");
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(
      mockCategories.map((c) => c.name),
    );
  });

  it("calls onChange with the updated {name, category_id, description}", async () => {
    const onChange = vi.fn();
    render(
      <NeededItemQuickAddForm value={createEmptyNeededItemQuickAddValue()} onChange={onChange} />,
    );
    fireEvent.change(screen.getByLabelText("Nazwa"), { target: { value: "Tamburyn" } });
    expect(onChange).toHaveBeenCalledWith({ name: "Tamburyn", category_id: 0, description: "" });
    await screen.findByText("Zabawka"); // wait for the async useCategories() fetch to settle
  });

  it("disables every field when `disabled` is true", async () => {
    render(
      <NeededItemQuickAddForm
        value={createEmptyNeededItemQuickAddValue()}
        onChange={vi.fn()}
        disabled
      />,
    );
    expect(screen.getByLabelText("Nazwa")).toBeDisabled();
    expect(screen.getByLabelText("Typ")).toBeDisabled();
    expect(screen.getByLabelText("Doprecyzowanie (opcjonalnie)")).toBeDisabled();
    await screen.findByText("Zabawka"); // wait for the async useCategories() fetch to settle
  });
});
