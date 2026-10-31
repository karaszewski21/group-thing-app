import { render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import type { ListingMode } from "../api/itemListingPreferences";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ParticipantItemsPreview,
  type ParticipantPreviewItem,
} from "../components/shared/ParticipantItemsPreview";

function renderWithProviders(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

function item(itemId: string, name: string, addedAt: string, mode: ListingMode = "GIFT"): ParticipantPreviewItem {
  return { itemId, name, modes: [mode], thumbUrl: null, addedAt };
}

/** Bartek's three newest, as the event payload sends them (newest first). */
const NEWEST: ParticipantPreviewItem[] = [
  item("it-7", "Kurtka przeciwdeszczowa", "2026-10-30T09:00:00"),
  item("it-6", "Rower dziecięcy 16 cali", "2026-10-28T09:00:00", "SWAP"),
  item("it-5", "Gra Carcassonne", "2026-10-23T09:00:00"),
];

describe("ParticipantItemsPreview", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T12:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders at most 3 rows, each with its mode label and how long ago it was added (UTC)", () => {
    renderWithProviders(
      <ParticipantItemsPreview
        items={[...NEWEST, item("it-4", "Klocki", "2026-10-01T09:00:00")]}
        total={4}
        partyId="p-bartek"
        context={{ kind: "event", id: "ev-1" }}
        organizerSlug="zielony-krag"
      />,
    );

    const links = screen.getAllByRole("link", { name: /Kurtka|Rower|Carcassonne|Klocki/ });
    expect(links).toHaveLength(3);
    expect(links[0]).toHaveTextContent("Kurtka przeciwdeszczowa");
    expect(links[0]).toHaveTextContent("Weź na stałe · dodano wczoraj");
    expect(links[1]).toHaveTextContent("Zamiana · 3 dni temu");
    expect(links[2]).toHaveTextContent("Weź na stałe · tydzień temu");
    expect(screen.queryByText("Klocki")).not.toBeInTheDocument();
  });

  it("links items and Pokaż więcej (N) with the event context", () => {
    renderWithProviders(
      <ParticipantItemsPreview
        items={NEWEST}
        total={12}
        partyId="p-bartek"
        context={{ kind: "event", id: "ev-1" }}
        organizerSlug="zielony-krag"
      />,
    );

    expect(screen.getByRole("link", { name: /Kurtka/ })).toHaveAttribute(
      "href",
      "/zielony-krag/product/it-7?event=ev-1",
    );
    const more = screen.getByRole("link", { name: "Pokaż więcej (12)" });
    expect(more).toHaveAttribute("href", "/p-bartek/items?event=ev-1");
    expect(more).toHaveTextContent("Pokaż więcej (12) ›");
  });

  it("uses ?term= on the term page and offers no Pokaż więcej for 3 items or fewer", () => {
    renderWithProviders(
      <ParticipantItemsPreview
        items={NEWEST}
        total={3}
        partyId="21"
        context={{ kind: "term", id: "t-1" }}
        organizerSlug={null}
      />,
    );

    expect(screen.getByRole("link", { name: /Gra Carcassonne/ })).toHaveAttribute("href", "/product/it-5?term=t-1");
    expect(screen.queryByRole("link", { name: /Pokaż więcej/ })).not.toBeInTheDocument();
  });

  it("renders the actions slot under each row, outside the item link", () => {
    renderWithProviders(
      <ParticipantItemsPreview
        items={NEWEST.slice(0, 1)}
        total={1}
        partyId="21"
        context={{ kind: "term", id: "t-1" }}
        organizerSlug="ania"
        renderActions={(it) => <button type="button">{`Weź na stałe: ${it.name}`}</button>}
      />,
    );

    const button = screen.getByRole("button", { name: "Weź na stałe: Kurtka przeciwdeszczowa" });
    const link = screen.getByRole("link", { name: /Kurtka/ });
    expect(link).not.toContainElement(button);
    expect(within(link.parentElement!).getByRole("button")).toBe(button);
  });

  it("renders nothing for a participant without items", () => {
    const { container } = renderWithProviders(
      <ParticipantItemsPreview items={[]} total={0} partyId="21" context={null} organizerSlug="ania" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
