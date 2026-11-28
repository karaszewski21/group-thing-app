import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ItemCard } from "../components/shared/ItemCard";
import { renderWithRoute } from "./renderWithRoute";

function renderCard(marker?: string) {
  return renderWithRoute(
    <ItemCard
      href="/ania/product/7"
      name="Rowerek biegowy Puky"
      condition="GOOD"
      thumbUrl={null}
      mode="GIFT"
      reservation={null}
      marker={marker}
    />,
    { url: "/wanted/abc" },
  );
}

describe("ItemCard", () => {
  it("shows the marker beside the offer badge when one is passed", () => {
    renderCard("nowe");

    const card = screen.getByRole("article");
    expect(card).toHaveTextContent("nowe");
    expect(card).toHaveTextContent("Oddam");
    expect(screen.getByRole("link", { name: "Rowerek biegowy Puky" })).toHaveAttribute("href", "/ania/product/7");
  });

  it("shows the featured corner badge in the marker's place, the offer badge staying left", () => {
    renderWithRoute(
      <ItemCard
        href="/ania/product/7"
        name="Rowerek biegowy Puky"
        condition="GOOD"
        thumbUrl={null}
        mode="GIFT"
        reservation={null}
        featured
        marker="nowe"
      />,
      { url: "/ania/items" },
    );

    const star = screen.getByText("⭐");
    expect(star).toHaveAttribute("aria-hidden", "true");
    const badge = star.parentElement as HTMLElement;
    expect(badge).toHaveClass("bg-ink", "text-on-ink", "ml-auto");
    expect(badge).toHaveTextContent(/^⭐ Wyróżnione$/);
    expect(screen.queryByText("nowe")).not.toBeInTheDocument();
    const oddam = screen.getByText("Oddam");
    expect(oddam).not.toHaveClass("ml-auto");
    expect(oddam.parentElement).toBe(badge.parentElement);
    expect(oddam.parentElement).toHaveClass("flex-wrap");
  });

  it("shows no marker without the prop", () => {
    renderCard();

    expect(screen.queryByText("nowe")).not.toBeInTheDocument();
    expect(screen.getByRole("article")).toHaveTextContent("Oddam");
  });

  it("shows a POINTS item's price on the orange badge, read as „Za punkty: N pkt”", () => {
    renderWithRoute(
      <ItemCard href="/ania/product/8" name="Rower 16″" condition="GOOD" thumbUrl={null} mode="POINTS" pointsPrice={60} reservation={null} />,
      { url: "/search" },
    );

    const hidden = screen.getByText("Za punkty:");
    expect(hidden).toHaveClass("sr-only");
    const badge = hidden.parentElement as HTMLElement;
    expect(badge).toHaveClass("bg-orange", "text-ink");
    expect(badge).toHaveTextContent(/^Za punkty: 60 pkt$/);
  });

  it("falls back to „Za punkty” on a POINTS item without a price", () => {
    renderWithRoute(
      <ItemCard href="/ania/product/8" name="Rower 16″" condition="GOOD" thumbUrl={null} mode="POINTS" reservation={null} />,
      { url: "/search" },
    );

    const badge = screen.getByText("Za punkty");
    expect(badge).toHaveClass("bg-orange", "text-ink");
    expect(screen.queryByText(/pkt/)).not.toBeInTheDocument();
  });
});
