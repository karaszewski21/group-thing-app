import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ItemQuickAddForm } from "../components/shared/ItemQuickAddForm";
import { createEmptyItemQuickAddValue } from "../utils/itemQuickAdd";
import { CONDITION_LABELS } from "../utils/productPicker";
import { CATEGORY_LABELS, PRODUCT_CATEGORIES } from "../utils/productCategory";

describe("ItemQuickAddForm", () => {
  it("renders exactly 3 fields (name input, condition select, type select) with no product dropdown", () => {
    render(<ItemQuickAddForm value={createEmptyItemQuickAddValue()} onChange={vi.fn()} />);

    expect(screen.getByLabelText("Nazwa")).toBeInTheDocument();
    expect(screen.getByLabelText("Stan")).toBeInTheDocument();
    expect(screen.getByLabelText("Typ")).toBeInTheDocument();

    // no catalog/product picker dropdown ("+ inny przedmiot" option is the ProductPicker marker)
    expect(screen.queryByText("+ inny przedmiot")).not.toBeInTheDocument();

    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
  });

  it("`Stan` select options match CONDITION_LABELS", () => {
    render(<ItemQuickAddForm value={createEmptyItemQuickAddValue()} onChange={vi.fn()} />);
    const select = screen.getByLabelText("Stan") as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels).toEqual(Object.values(CONDITION_LABELS));
  });

  it("`Typ` select options match CATEGORY_LABELS/PRODUCT_CATEGORIES", () => {
    render(<ItemQuickAddForm value={createEmptyItemQuickAddValue()} onChange={vi.fn()} />);
    const select = screen.getByLabelText("Typ") as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels).toEqual(PRODUCT_CATEGORIES.map((c) => CATEGORY_LABELS[c]));
  });

  it("calls onChange with updated {name, condition, category} when fields are edited", () => {
    const onChange = vi.fn();
    render(<ItemQuickAddForm value={createEmptyItemQuickAddValue()} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Nazwa"), { target: { value: "Rowerek" } });

    expect(onChange).toHaveBeenCalledWith({
      name: "Rowerek",
      condition: "GOOD",
      category: "OTHER",
    });
  });

  it("disables the name input and selects when `disabled` is true", () => {
    render(
      <ItemQuickAddForm value={createEmptyItemQuickAddValue()} onChange={vi.fn()} disabled />,
    );
    expect(screen.getByLabelText("Nazwa")).toBeDisabled();
    expect(screen.getByLabelText("Stan")).toBeDisabled();
    expect(screen.getByLabelText("Typ")).toBeDisabled();
  });
});
