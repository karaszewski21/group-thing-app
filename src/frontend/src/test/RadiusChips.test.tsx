import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RadiusChips } from "../components/shared/RadiusChips";

function chips() {
  return within(screen.getByRole("group", { name: "Odległość" })).getAllByRole("button");
}

describe("RadiusChips", () => {
  it("lists „Tylko tu” and the three radii in order, with the picked one pressed", () => {
    render(<RadiusChips value={25} onChange={() => {}} />);

    expect(chips().map((chip) => chip.textContent)).toEqual(["Tylko tu", "+10 km", "+25 km", "+50 km"]);
    expect(chips().map((chip) => chip.getAttribute("aria-pressed"))).toEqual(["false", "false", "true", "false"]);
    for (const chip of chips()) expect(chip).toHaveAttribute("type", "button");
  });

  it("no radius presses „Tylko tu”, which reports null; a radius reports its kilometres", () => {
    const onChange = vi.fn();
    render(<RadiusChips value={null} onChange={onChange} />);

    expect(screen.getByRole("button", { name: "Tylko tu" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "+50 km" }));
    expect(onChange).toHaveBeenLastCalledWith(50);
    fireEvent.click(screen.getByRole("button", { name: "Tylko tu" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
