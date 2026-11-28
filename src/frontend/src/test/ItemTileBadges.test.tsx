import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReservedByResponse } from "../api/groups";
import { ItemTileBadges } from "../components/shared/ItemTileBadges";

/** The text left once `aria-hidden` parts are removed. */
function visibleToScreenReaders(element: HTMLElement): string {
  const copy = element.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => hidden.remove());
  return (copy.textContent ?? "").trim();
}

describe("ItemTileBadges", () => {
  it("renders the GIFT and SWAP intent as text pills in their exchange-mode tone", () => {
    render(<ItemTileBadges modes={["SWAP", "GIFT"]} />);

    const swap = screen.getByText("Chcę się zamienić");
    const gift = screen.getByText("Chcę oddać");
    expect(swap).toHaveClass("bg-accent-soft", "text-accent-fg", "rounded-full");
    expect(gift).toHaveClass("bg-primary-soft", "text-primary-fg", "rounded-full");
    expect(swap.parentElement).toHaveTextContent(/^Chcę się zamienić Chcę oddać$/);
  });

  it("shows a POINTS pill as its price with the hidden „Za punkty:”, or „Za punkty” without one", () => {
    const { unmount } = render(<ItemTileBadges modes={["POINTS"]} pointsPrice={40} />);
    const hidden = screen.getByText("Za punkty:");
    expect(hidden).toHaveClass("sr-only");
    expect(hidden.parentElement).toHaveClass("bg-orange", "text-ink", "rounded-full");
    expect(hidden.parentElement).toHaveTextContent(/^Za punkty: 40 pkt$/);
    unmount();

    render(<ItemTileBadges modes={["POINTS"]} />);
    expect(screen.getByText("Za punkty")).toHaveClass("bg-orange", "text-ink");
  });

  it("renders the featured pill first, its ⭐ hidden from assistive tech, before the mode and the reservation", () => {
    render(<ItemTileBadges featured modes={["GIFT"]} reservation={{ by_name: null, by_me: true }} />);

    const star = screen.getByText("⭐");
    expect(star).toHaveAttribute("aria-hidden", "true");
    const pill = star.parentElement as HTMLElement;
    expect(pill).toHaveClass("bg-ink", "text-on-ink", "rounded-full", "px-2", "text-[11px]");
    expect(visibleToScreenReaders(pill)).toBe("Wyróżnione");
    expect(pill.parentElement?.firstElementChild).toBe(pill);
    expect(pill.parentElement).toHaveTextContent(/^⭐ Wyróżnione Chcę oddać Zarezerwowana · przez Ciebie$/);
  });

  it("renders the row with only the featured pill", () => {
    render(<ItemTileBadges featured modes={[]} />);

    expect(screen.getByText("⭐").parentElement?.parentElement).toHaveTextContent(/^⭐ Wyróżnione$/);
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
