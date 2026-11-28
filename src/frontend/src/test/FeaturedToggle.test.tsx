import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FeaturedToggle } from "../features/items/FeaturedToggle";

describe("FeaturedToggle", () => {
  it("keeps the item-named label in both states while aria-pressed and the text follow the state", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<FeaturedToggle featured={false} onToggle={onToggle} itemName="Rower" />);

    const off = screen.getByRole("button", { name: "Wyróżnij: Rower" });
    expect(off).toHaveAttribute("type", "button");
    expect(off).toHaveAttribute("aria-pressed", "false");
    expect(off).toHaveTextContent("⭐ Wyróżnij");
    expect(off.querySelector('[aria-hidden="true"]')).toHaveTextContent("⭐");

    fireEvent.click(off);
    expect(onToggle).toHaveBeenCalledWith(true);

    rerender(<FeaturedToggle featured onToggle={onToggle} itemName="Rower" />);
    const on = screen.getByRole("button", { name: "Wyróżnij: Rower" });
    expect(on).toHaveAttribute("aria-pressed", "true");
    expect(on).toHaveTextContent("⭐ Wyróżnione");
    expect(on).toHaveClass("bg-ink", "text-on-ink");
  });

  it("is disabled only while its save is in flight", async () => {
    let finish!: () => void;
    const onToggle = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    render(<FeaturedToggle featured onToggle={onToggle} itemName="Rower" />);

    const button = screen.getByRole("button", { name: "Wyróżnij: Rower" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledWith(false);
    expect(button).toBeDisabled();

    await act(async () => finish());
    expect(button).toBeEnabled();
  });
});
