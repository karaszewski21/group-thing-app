import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NeededItemQuickAddForm } from "../components/shared/NeededItemQuickAddForm";
import { createEmptyNeededItemQuickAddValue } from "../utils/neededItemQuickAdd";

describe("NeededItemQuickAddForm", () => {
  it("renders a name and a description input, with no category field", () => {
    render(<NeededItemQuickAddForm value={createEmptyNeededItemQuickAddValue()} onChange={vi.fn()} />);

    expect(screen.getByLabelText("Nazwa")).toHaveAttribute("placeholder", "np. Termos");
    expect(screen.getByLabelText("Doprecyzowanie (opcjonalnie)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Typ")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
  });

  it("calls onChange with the plain {name, description} value", () => {
    const onChange = vi.fn();
    render(<NeededItemQuickAddForm value={createEmptyNeededItemQuickAddValue()} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Nazwa"), { target: { value: "Termos" } });

    expect(onChange).toHaveBeenCalledWith({ name: "Termos", description: "" });
  });

  it("disables every field when `disabled` is true", () => {
    render(
      <NeededItemQuickAddForm value={createEmptyNeededItemQuickAddValue()} onChange={vi.fn()} disabled />,
    );

    expect(screen.getByLabelText("Nazwa")).toBeDisabled();
    expect(screen.getByLabelText("Doprecyzowanie (opcjonalnie)")).toBeDisabled();
  });
});
