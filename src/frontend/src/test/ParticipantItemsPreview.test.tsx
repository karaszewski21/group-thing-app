import { screen, within } from "@testing-library/react";
import { renderWithRoute } from "./renderWithRoute";
import type { ReactElement } from "react";
import type { ReservedByResponse } from "../api/groups";
import type { ListingMode } from "../api/itemListingPreferences";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ParticipantItemsPreview,
  type ParticipantPreviewItem,
} from "../components/shared/ParticipantItemsPreview";

function renderWithProviders(ui: ReactElement) {
  return renderWithRoute(ui, { url: "/" });
}

function item(
  itemId: string,
  name: string,
  addedAt: string,
  mode: ListingMode = "GIFT",
  reservation: ReservedByResponse | null = null,
): ParticipantPreviewItem {
  return { itemId, name, modes: [mode], thumbUrl: null, addedAt, reservation };
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

  it("renders at most 3 rows, each with its intent pill and how long ago it was added (UTC)", () => {
    renderWithProviders(
      <ParticipantItemsPreview
        items={[...NEWEST, item("it-4", "Klocki", "2026-10-01T09:00:00")]}
        total={4}
        partyId="p-bartek"
      />,
    );

    const links = screen.getAllByRole("link", { name: /Kurtka|Rower|Carcassonne|Klocki/ });
    expect(links).toHaveLength(3);
    expect(links[0]).toHaveTextContent("Kurtka przeciwdeszczowa");
    expect(within(links[0]).getByText("Chcę oddać")).toHaveClass("bg-primary-soft");
    expect(links[0]).toHaveTextContent("dodano wczoraj");
    expect(within(links[1]).getByText("Chcę się zamienić")).toHaveClass("bg-accent-soft");
    expect(links[1]).toHaveTextContent("3 dni temu");
    expect(links[2]).toHaveTextContent("tydzień temu");
    expect(screen.queryByText("Klocki")).not.toBeInTheDocument();
  });

  it("makes each row one link to the plain product page, with no buttons, and Pokaż więcej without a query", () => {
    renderWithProviders(
      <ParticipantItemsPreview items={NEWEST} total={12} partyId="p-bartek" />,
    );

    expect(screen.getByRole("link", { name: /Kurtka/ })).toHaveAttribute("href", "/p-bartek/product/it-7");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    const more = screen.getByRole("link", { name: "Pokaż więcej (12)" });
    expect(more).toHaveAttribute("href", "/p-bartek/items");
    expect(more).toHaveTextContent("Pokaż więcej (12) ›");
  });

  it("links items under the participant's party id and offers no Pokaż więcej for 3 items or fewer", () => {
    renderWithProviders(<ParticipantItemsPreview items={NEWEST} total={3} partyId="21" />);

    expect(screen.getByRole("link", { name: /Gra Carcassonne/ })).toHaveAttribute("href", "/21/product/it-5");
    expect(screen.queryByRole("link", { name: /Pokaż więcej/ })).not.toBeInTheDocument();
  });

  it("keeps a reserved row's link and intent pill and adds the reserved pill with the reserver's name", () => {
    renderWithProviders(
      <ParticipantItemsPreview
        items={[
          item("it-7", "Kredki 24 kolory", "2026-10-30T09:00:00", "GIFT", { by_name: "Anna", by_me: false }),
          item("it-6", "Rower dziecięcy 16 cali", "2026-10-28T09:00:00", "SWAP"),
        ]}
        total={2}
        partyId="p-bartek"
      />,
    );

    const reserved = screen.getByRole("link", { name: /Kredki/ });
    expect(reserved).toHaveAttribute("href", "/p-bartek/product/it-7");
    expect(within(reserved).getByText("Chcę oddać")).toBeInTheDocument();
    expect(within(reserved).getByText("Zarezerwowana · przez Anna")).toHaveClass("bg-teal-soft");
    expect(screen.getByRole("link", { name: /Rower/ })).not.toHaveTextContent("Zarezerwowana");
  });

  it("renders nothing for a participant without items", () => {
    const { container } = renderWithProviders(
      <ParticipantItemsPreview items={[]} total={0} partyId="21" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
