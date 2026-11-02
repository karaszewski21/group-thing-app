import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VisibilityToggle } from "../pages/items/VisibilityToggle";

describe("VisibilityToggle", () => {
  it("marks the current value pressed and calls back with the other one", () => {
    const onChange = vi.fn();
    render(<VisibilityToggle value="PUBLIC" onChange={onChange} itemName="Rowerek" />);

    const group = screen.getByRole("group", { name: "Widoczność: Rowerek" });
    const pub = screen.getByRole("button", { name: "Publiczna" });
    const priv = screen.getByRole("button", { name: "Prywatna" });
    expect(group).toContainElement(pub);
    expect(pub).toHaveAttribute("aria-pressed", "true");
    expect(priv).toHaveAttribute("aria-pressed", "false");
    expect(pub).toHaveAttribute("type", "button");
    expect(priv).toHaveAttribute("type", "button");

    fireEvent.click(priv);
    expect(onChange).toHaveBeenCalledWith("PRIVATE");
  });

  it("clicking the current value does not call back", () => {
    const onChange = vi.fn();
    render(<VisibilityToggle value="PRIVATE" onChange={onChange} itemName="Rowerek" />);

    expect(screen.getByRole("button", { name: "Prywatna" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Prywatna" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
