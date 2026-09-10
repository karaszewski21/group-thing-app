import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NeededItemQuickAddForm } from "../components/shared/NeededItemQuickAddForm";
import { createEmptyNeededItemQuickAddValue } from "../utils/neededItemQuickAdd";
import { CATEGORY_LABELS, PRODUCT_CATEGORIES } from "../utils/productCategory";

describe("NeededItemQuickAddForm", () => {
  it("renders name input, type select, and a description input (no condition)", () => {
    render(
      <NeededItemQuickAddForm value={createEmptyNeededItemQuickAddValue()} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText("Nazwa")).toBeInTheDocument();
    expect(screen.getByLabelText("Typ")).toBeInTheDocument();
    expect(screen.getByLabelText("Doprecyzowanie (opcjonalnie)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Stan")).not.toBeInTheDocument();

    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
  });

  it("`Typ` options match PRODUCT_CATEGORIES / CATEGORY_LABELS", () => {
    render(
      <NeededItemQuickAddForm value={createEmptyNeededItemQuickAddValue()} onChange={vi.fn()} />,
    );
    const select = screen.getByLabelText("Typ") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(
      PRODUCT_CATEGORIES.map((c) => CATEGORY_LABELS[c]),
    );
  });

  it("calls onChange with the updated {name, category, description}", () => {
    const onChange = vi.fn();
    render(
      <NeededItemQuickAddForm value={createEmptyNeededItemQuickAddValue()} onChange={onChange} />,
    );
    fireEvent.change(screen.getByLabelText("Nazwa"), { target: { value: "Tamburyn" } });
    expect(onChange).toHaveBeenCalledWith({ name: "Tamburyn", category: "OTHER", description: "" });
  });

  it("disables every field when `disabled` is true", () => {
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
  });
});
