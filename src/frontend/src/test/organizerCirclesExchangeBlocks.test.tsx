import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type {
  OrganizerCircle,
  OrganizerExchangeItem,
  OrganizerNeededItem,
  OrganizerPageResponse,
} from "../api/groups";
import type { PublicOrganizationResponse } from "../api/organizations";
import { CirclesGridBlock, isCirclesGridEmpty } from "../pages/organizer/blocks/CirclesGridBlock";
import { ExchangeBoardBlock, isExchangeBoardEmpty } from "../pages/organizer/blocks/ExchangeBoardBlock";
import { ExchangeCountsBlock, isExchangeCountsEmpty } from "../pages/organizer/blocks/ExchangeCountsBlock";
import { ExchangeItemCard } from "../pages/organizer/blocks/ExchangeItemCard";
import { isNeededItemsEmpty, NeededItemsBlock } from "../pages/organizer/blocks/NeededItemsBlock";
import type { OrganizerPageData } from "../pages/organizer/layouts/types";

const SLUG = "akademia-orlik";

const organization: PublicOrganizationResponse = {
  slug: SLUG,
  name: "Akademia Orlik",
  primary_color: null,
  accent_color: null,
  page_layout: "CIRCLES",
  palette_preset: null,
};

function circle(id: string, overrides: Partial<OrganizerCircle> = {}): OrganizerCircle {
  return {
    id,
    name: `Grupa ${id}`,
    layout_mode: "CIRCLE",
    next_term: { id: `term-${id}`, occurs_on: "2026-10-15T09:30:00", attendee_count: 7 },
    upcoming_term_count: 4,
    ...overrides,
  };
}

function item(id: string, mode: OrganizerExchangeItem["mode"], overrides: Partial<OrganizerExchangeItem> = {}) {
  return {
    item_id: id,
    product_name: `Rzecz ${id}`,
    condition: "GOOD",
    mode,
    thumb_url: null,
    term_id: `term-${id}`,
    group_id: "g1",
    occurs_on: "2026-10-14T17:00:00",
    ...overrides,
  } satisfies OrganizerExchangeItem;
}

function directory(overrides: Partial<OrganizerPageResponse> = {}): OrganizerPageResponse {
  return {
    circles: [],
    upcoming_terms: [],
    exchange: { counts: { GIFT: 0, SWAP: 0, LEND: 0 }, items: [] },
    needed_items: [],
    stats: { circle_count: 0, upcoming_term_count: 0, family_count: null },
    ...overrides,
  };
}

function pageData(overrides: Partial<OrganizerPageResponse> = {}): OrganizerPageData {
  return { organization, directory: directory(overrides), directoryStatus: "ready" };
}

function renderWithRouter(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("CirclesGridBlock", () => {
  it("cards link to the next term, or to the filtered terms list without one", () => {
    const data = pageData({
      circles: [circle("a", { name: "Maluchy 0-2" }), circle("b", { name: "Rytmika", next_term: null })],
    });
    renderWithRouter(<CirclesGridBlock data={data} variant="cards" mode="visitor" />);

    expect(screen.getByRole("heading", { name: "Nasze grupy" })).toBeInTheDocument();
    const withTerm = screen.getByRole("link", { name: /Maluchy 0-2/ });
    expect(withTerm).toHaveAttribute("href", `/${SLUG}/grupa/a/term/term-a`);
    expect(withTerm).toHaveTextContent("zapisanych: 7 · 4 terminy");
    expect(withTerm).toHaveTextContent("nast.: Cz 15 paź, 09:30");

    const withoutTerm = screen.getByRole("link", { name: /Rytmika/ });
    expect(withoutTerm).toHaveAttribute("href", `/${SLUG}/terminy?group_id=b`);
    expect(withoutTerm).toHaveTextContent("brak zaplanowanych terminów");
  });

  it("featured renders an anonymous circle visual capped at 16 seats, and none at 0 attendees", () => {
    const busy = circle("a", {
      name: "Orliki 2017",
      layout_mode: "PITCH",
      next_term: { id: "t1", occurs_on: "2026-10-14T17:00:00", attendee_count: 20 },
    });
    const { unmount } = renderWithRouter(
      <CirclesGridBlock data={pageData({ circles: [busy] })} variant="featured" mode="visitor" />,
    );

    expect(screen.getByRole("heading", { name: "Nasza grupa" })).toBeInTheDocument();
    const visual = screen.getByRole("img", { name: "Zapisanych 20 rodzin" });
    expect(visual.querySelectorAll("[data-seat]")).toHaveLength(16);
    expect(visual).toHaveTextContent("+4");
    expect(screen.getByRole("link", { name: "Zobacz zajęcia →" })).toHaveAttribute(
      "href",
      `/${SLUG}/grupa/a/term/t1`,
    );
    unmount();

    const quiet = circle("a", { next_term: { id: "t1", occurs_on: "2026-10-14T17:00:00", attendee_count: 0 } });
    renderWithRouter(<CirclesGridBlock data={pageData({ circles: [quiet] })} variant="featured" mode="visitor" />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("ExchangeCountsBlock", () => {
  it("shows a tile per mode, linking only the tiles with items", () => {
    const data = pageData({
      exchange: { counts: { GIFT: 3, SWAP: 0, LEND: 1 }, items: [item("1", "LEND"), item("2", "GIFT")] },
    });
    renderWithRouter(<ExchangeCountsBlock data={data} variant="tiles3" mode="visitor" />);

    expect(screen.getByRole("heading", { name: "Wymiana rzeczy" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Oddam\s*3/ })).toHaveAttribute("href", `/${SLUG}/grupa/g1/term/term-2`);
    expect(screen.getByRole("link", { name: /Wypożyczę\s*1/ })).toHaveAttribute(
      "href",
      `/${SLUG}/grupa/g1/term/term-1`,
    );
    expect(screen.queryByRole("link", { name: /Zamienię/ })).not.toBeInTheDocument();
    expect(screen.getByText("Zamienię")).toBeInTheDocument();
  });
});

describe("ExchangeBoardBlock", () => {
  it("filters the board by mode tab and disables empty tabs", () => {
    const data = pageData({
      exchange: {
        counts: { GIFT: 1, SWAP: 2, LEND: 0 },
        items: [item("1", "GIFT"), item("2", "SWAP"), item("3", "SWAP")],
      },
    });
    renderWithRouter(<ExchangeBoardBlock data={data} variant="grid2" mode="visitor" />);

    const tablist = screen.getByRole("tablist");
    const all = within(tablist).getByRole("tab", { name: /Wszystko\s*3/ });
    expect(all).toHaveAttribute("aria-selected", "true");
    const board = screen.getByRole("tabpanel");
    expect(all).toHaveAttribute("aria-controls", board.id);
    expect(within(board).getAllByRole("link")).toHaveLength(3);
    expect(within(tablist).getByRole("tab", { name: /Wypożyczę\s*0/ })).toBeDisabled();

    fireEvent.click(within(tablist).getByRole("tab", { name: /Zamienię\s*2/ }));
    const filtered = screen.getByRole("tabpanel");
    expect(within(filtered).getAllByRole("link")).toHaveLength(2);
    expect(within(filtered).queryByText("Rzecz 1")).not.toBeInTheDocument();
  });
});

describe("ExchangeItemCard", () => {
  it("renders the thumbnail or a placeholder and never a lister", () => {
    const { unmount } = renderWithRouter(
      <ExchangeItemCard slug={SLUG} item={item("1", "SWAP", { thumb_url: "https://cdn.example/1.jpg" })} />,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", `/${SLUG}/grupa/g1/term/term-1`);
    expect(within(link).getByRole("img", { name: "Rzecz 1" })).toHaveAttribute("src", "https://cdn.example/1.jpg");
    expect(link).toHaveTextContent("Zamienię");
    expect(link).toHaveTextContent("Dobry");
    expect(link).toHaveTextContent("odbiór: Śr 14 paź");
    expect(link).not.toHaveTextContent(/wystawi|dodał|dodała/i);
    unmount();

    renderWithRouter(<ExchangeItemCard slug={SLUG} item={item("2", "GIFT")} />);
    expect(screen.queryByRole("img", { name: "Rzecz 2" })).not.toBeInTheDocument();
    expect(screen.getByRole("link").querySelector("svg")).not.toBeNull();
  });
});

describe("NeededItemsBlock", () => {
  it("links open items and marks claimed ones without a name", () => {
    const needed: OrganizerNeededItem[] = [
      { id: "n1", term_id: "term-a", group_id: "a", product_name: "Koc piknikowy", claimed: false },
      { id: "n2", term_id: "term-a", group_id: "a", product_name: "Głośnik", claimed: true },
    ];
    renderWithRouter(
      <NeededItemsBlock data={pageData({ needed_items: needed, circles: [circle("a")] })} variant="list" mode="visitor" />,
    );

    expect(screen.getByRole("heading", { name: "Potrzebne na najbliższe zajęcia" })).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByRole("link", { name: /Zobacz/ })).toHaveAttribute("href", `/${SLUG}/grupa/a/term/term-a`);
    expect(rows[0]).toHaveTextContent("Cz 15 paź");
    expect(within(rows[1]).getByText("Zapewnione")).toBeInTheDocument();
    expect(within(rows[1]).queryByRole("link")).not.toBeInTheDocument();
    expect(rows[1].textContent).toBe("GłośnikZapewnione");
  });
});

describe("circle and exchange isEmpty predicates", () => {
  it("hide each block exactly when its data is empty", () => {
    expect(isCirclesGridEmpty(pageData())).toBe(true);
    expect(isCirclesGridEmpty(pageData({ circles: [circle("a")] }))).toBe(false);

    expect(isExchangeCountsEmpty(pageData())).toBe(true);
    expect(isExchangeCountsEmpty(pageData({ exchange: { counts: { GIFT: 0, SWAP: 0, LEND: 1 }, items: [] } }))).toBe(
      false,
    );

    expect(isExchangeBoardEmpty(pageData({ exchange: { counts: { GIFT: 2, SWAP: 0, LEND: 0 }, items: [] } }))).toBe(
      true,
    );
    expect(
      isExchangeBoardEmpty(pageData({ exchange: { counts: { GIFT: 1, SWAP: 0, LEND: 0 }, items: [item("1", "GIFT")] } })),
    ).toBe(false);

    expect(isNeededItemsEmpty(pageData())).toBe(true);
    expect(
      isNeededItemsEmpty(
        pageData({
          needed_items: [{ id: "n", term_id: "t", group_id: "g", product_name: "Koc", claimed: false }],
        }),
      ),
    ).toBe(false);
  });
});
