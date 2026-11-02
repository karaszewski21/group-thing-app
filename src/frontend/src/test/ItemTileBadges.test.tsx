import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReservedByResponse } from "../api/groups";
import { ItemTileBadges } from "../components/shared/ItemTileBadges";

describe("ItemTileBadges", () => {
  it("renders the GIFT and SWAP intent as text pills in their exchange-mode tone", () => {
    render(<ItemTileBadges modes={["SWAP", "GIFT"]} />);

    const swap = screen.getByText("Chcę się zamienić");
    const gift = screen.getByText("Chcę oddać");
    expect(swap).toHaveClass("bg-accent-soft", "text-accent-fg", "rounded-full");
    expect(gift).toHaveClass("bg-primary-soft", "text-primary-fg", "rounded-full");
    expect(swap.parentElement).toHaveTextContent(/^Chcę się zamienić Chcę oddać$/);
  });

  it("renders nothing without a mode or a reservation", () => {
    const { container } = render(<ItemTileBadges modes={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each<[string, ReservedByResponse | null, string | null]>([
    ["an anonymous viewer (no name)", { by_name: null, by_me: false }, "Zarezerwowana"],
    ["another logged-in viewer", { by_name: "Anna", by_me: false }, "Zarezerwowana · przez Anna"],
    ["the reserver themself", { by_name: "Anna", by_me: true }, "Zarezerwowana · przez Ciebie"],
    ["an available item", null, null],
  ])("keeps the intent pill and adds the teal reserved pill for %s", (_label, reservation, expected) => {
    render(<ItemTileBadges modes={["GIFT"]} reservation={reservation} />);

    const gift = screen.getByText("Chcę oddać");
    if (expected === null) {
      expect(screen.queryByText(/Zarezerwowana/)).not.toBeInTheDocument();
      expect(gift.parentElement).toHaveTextContent(/^Chcę oddać$/);
      return;
    }
    expect(screen.getByText(expected)).toHaveClass("bg-teal-soft", "text-ink", "rounded-full");
    expect(gift.parentElement).toHaveTextContent(`Chcę oddać ${expected}`);
  });
});
