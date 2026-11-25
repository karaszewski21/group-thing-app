import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VisibilityToggle } from "../features/items/VisibilityToggle";

describe("VisibilityToggle", () => {
  it("a public item has „Publiczna” checked and picking „Prywatna” makes it private", () => {
    const onChange = vi.fn();
    render(<VisibilityToggle value="PUBLIC" onChange={onChange} itemName="Rowerek" />);

    expect(screen.getByRole("radiogroup", { name: "Kto widzi rzecz Rowerek" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Publiczna: Rowerek" })).toHaveAttribute("aria-checked", "true");
    const priv = screen.getByRole("radio", { name: "Prywatna: Rowerek" });
    expect(priv).toHaveAttribute("aria-checked", "false");
    expect(priv).toHaveAttribute("type", "button");

    fireEvent.click(priv);
    expect(onChange).toHaveBeenCalledWith("PRIVATE");
  });

  it("a private item has „Prywatna” checked, picking „Publiczna” makes it public, re-picking does nothing", () => {
    const onChange = vi.fn();
    render(<VisibilityToggle value="PRIVATE" onChange={onChange} itemName="Rowerek" />);

    expect(screen.getByRole("radio", { name: "Prywatna: Rowerek" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "Prywatna: Rowerek" }));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("radio", { name: "Publiczna: Rowerek" }));
    expect(onChange).toHaveBeenCalledWith("PUBLIC");
  });
});
