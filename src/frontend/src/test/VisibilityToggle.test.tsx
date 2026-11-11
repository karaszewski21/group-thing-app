import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VisibilityToggle } from "../features/items/VisibilityToggle";

describe("VisibilityToggle", () => {
  it("an open lock is public and clicking it makes the item private", () => {
    const onChange = vi.fn();
    render(<VisibilityToggle value="PUBLIC" onChange={onChange} itemName="Rowerek" />);

    const lock = screen.getByRole("button", { name: "Prywatna: Rowerek" });
    expect(lock).toHaveAttribute("aria-pressed", "false");
    expect(lock).toHaveAttribute("type", "button");
    expect(lock).toHaveTextContent("");

    fireEvent.click(lock);
    expect(onChange).toHaveBeenCalledWith("PRIVATE");
  });

  it("a closed lock is private and clicking it makes the item public", () => {
    const onChange = vi.fn();
    render(<VisibilityToggle value="PRIVATE" onChange={onChange} itemName="Rowerek" />);

    const lock = screen.getByRole("button", { name: "Prywatna: Rowerek" });
    expect(lock).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(lock);
    expect(onChange).toHaveBeenCalledWith("PUBLIC");
  });
});
