import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithRoute } from "./renderWithRoute";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import type {
  OrganizerCircle,
  OrganizerExchangeItem,
  OrganizerNeededItem,
  OrganizerPageResponse,
} from "../api/groups";
import type { PublicOrganizationResponse } from "../api/organizations";
import { CirclesGridBlock, isCirclesGridEmpty } from "../features/owner-page/blocks/CirclesGridBlock";
import { ExchangeBoardBlock, isExchangeBoardEmpty } from "../features/owner-page/blocks/ExchangeBoardBlock";
import { ExchangeCountsBlock, isExchangeCountsEmpty } from "../features/owner-page/blocks/ExchangeCountsBlock";
import { ExchangeItemCard } from "../features/owner-page/blocks/ExchangeItemCard";
import { isNeededItemsEmpty, NeededItemsBlock } from "../features/owner-page/blocks/NeededItemsBlock";
import type { OrganizerPageData } from "../features/owner-page/layouts/types";

const SLUG = "akademia-orlik";

const organization: PublicOrganizationResponse = {
  slug: SLUG,
  name: "Akademia Orlik",
  primary_color: null,
  accent_color: null,
  page_layout: "CIRCLES",
  palette_preset: null,
  description: null,
  logo: null,
  cover: null,
  gallery: [],
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
    reservation: null,
    ...overrides,
  } satisfies OrganizerExchangeItem;
}

function directory(overrides: Partial<OrganizerPageResponse> = {}): OrganizerPageResponse {
  return {
    circles: [],
    upcoming_terms: [],
    exchange: { counts: { GIFT: 0, SWAP: 0, RESERVED: 0 }, items: [] },
    needed_items: [],
    recent_items: [],
    owner_nearest: null,
    stats: { circle_count: 0, upcoming_term_count: 0, family_count: null },
    ...overrides,
  };
}

function pageData(overrides: Partial<OrganizerPageResponse> = {}): OrganizerPageData {
  return { organization, directory: directory(overrides), directoryStatus: "ready" };
}

function renderWithRouter(ui: ReactElement) {
  return renderWithRoute(ui, { url: "/" });
}

describe("CirclesGridBlock", () => {
  it("cards link to the next term, or to the filtered terms list without one", () => {
    const data = pageData({
      circles: [circle("a", { name: "Maluchy 0-2" }), circle("b", { name: "Rytmika", next_term: null })],
    });
    renderWithRouter(<CirclesGridBlock data={data} variant="cards" mode="visitor" />);

    expect(screen.getByRole("heading", { name: "Nasze grupy" })).toBeInTheDocument();
    const withTerm = screen.getByRole("link", { name: "Zobacz grupę Maluchy 0-2" });
    expect(withTerm).toHaveAttribute("href", `/${SLUG}/group/a/term/term-a`);
    const withTermCard = withTerm.closest("li")!;
    expect(withTermCard).toHaveTextContent("zapisanych: 7 · 4 terminy");
    expect(withTermCard).toHaveTextContent("nast.: Cz 15 paź, 09:30");
    expect(within(withTermCard).getByRole("img", { name: "Zapisanych 7 rodzin" })).toBeInTheDocument();

    const withoutTerm = screen.getByRole("link", { name: "Zobacz grupę Rytmika" });
    expect(withoutTerm).toHaveAttribute("href", `/${SLUG}/terms?group_id=b`);
    expect(withoutTerm.closest("li")).toHaveTextContent("brak zaplanowanych terminów");
  });

  it("labels each card with its group layout: circle, pitch or table", () => {
    const data = pageData({
      circles: [
        circle("a", { layout_mode: "CIRCLE" }),
        circle("b", { layout_mode: "PITCH" }),
        circle("c", { layout_mode: "TABLE" }),
      ],
    });
    renderWithRouter(<CirclesGridBlock data={data} variant="cards" mode="visitor" />);

    const cards = screen.getAllByRole("listitem");
    ["Krąg", "Boisko", "Stół"].forEach((label, index) => {
      expect(within(cards[index]).getByText(label)).toBeInTheDocument();
    });
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
      `/${SLUG}/group/a/term/t1`,
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
      exchange: { counts: { GIFT: 3, SWAP: 0, RESERVED: 0 }, items: [item("2", "GIFT")] },
    });
    renderWithRouter(<ExchangeCountsBlock data={data} variant="tiles3" mode="visitor" />);

    expect(screen.getByRole("heading", { name: "Wymiana rzeczy" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /3\s*Chcę oddać/ })).toHaveAttribute("href", `/${SLUG}/group/g1/term/term-2`);
    expect(screen.queryByRole("link", { name: /Chcę się zamienić/ })).not.toBeInTheDocument();
    expect(screen.getByText("Chcę się zamienić")).toBeInTheDocument();
  });

  it("reads N Chcę oddać · N Chcę się zamienić · N Zarezerwowane, the reserved tile leading to a reserved item's term", () => {
    const reserved = item("9", "SWAP", { term_id: "term-r", reservation: { by_name: "Tomek", by_me: false } });
    const data = pageData({
      exchange: { counts: { GIFT: 3, SWAP: 4, RESERVED: 4 }, items: [item("1", "GIFT"), item("2", "SWAP"), reserved] },
    });
    renderWithRouter(<ExchangeCountsBlock data={data} variant="tiles3" mode="visitor" />);

    const section = screen.getByRole("heading", { name: "Wymiana rzeczy" }).closest("section");
    expect(section).toHaveTextContent(/3\s*Chcę oddać.*4\s*Chcę się zamienić.*4\s*Zarezerwowane/);
    expect(screen.getByRole("link", { name: /4\s*Zarezerwowane/ })).toHaveAttribute("href", `/${SLUG}/group/g1/term/term-r`);
  });
});

describe("ExchangeBoardBlock", () => {
  it("filters the board by the four tabs consistently with the counts", () => {
    const anna = { by_name: "Anna", by_me: false };
    const data = pageData({
      exchange: {
        counts: { GIFT: 1, SWAP: 2, RESERVED: 2 },
        items: [
          item("1", "GIFT"),
          item("2", "SWAP"),
          item("3", "SWAP"),
          item("4", "GIFT", { reservation: anna }),
          item("5", "SWAP", { reservation: { by_name: "Tomek", by_me: true } }),
        ],
      },
    });
    renderWithRouter(<ExchangeBoardBlock data={data} variant="grid2" mode="visitor" />);

    const tablist = screen.getByRole("tablist");
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Wszystkie 5",
      "Chcę oddać 1",
      "Chcę się zamienić 2",
      "Zarezerwowane 2",
    ]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    const board = screen.getByRole("tabpanel");
    expect(tabs[0]).toHaveAttribute("aria-controls", board.id);
    expect(within(board).getAllByRole("article")).toHaveLength(5);

    const shownFor = (index: number) => {
      fireEvent.click(tabs[index]);
      return within(screen.getByRole("tabpanel"))
        .getAllByRole("article")
        .map((card) => within(card).getByRole("link").textContent);
    };
    expect(shownFor(1)).toEqual(["Rzecz 1"]);
    expect(shownFor(2)).toEqual(["Rzecz 2", "Rzecz 3"]);
    expect(shownFor(3)).toEqual(["Rzecz 4", "Rzecz 5"]);
    const reservedBoard = screen.getByRole("tabpanel");
    expect(within(reservedBoard).getByText("Zarezerwowana · przez Anna")).toBeInTheDocument();
    expect(within(reservedBoard).getByText("Zarezerwowana · przez Ciebie")).toBeInTheDocument();
    expect(within(reservedBoard).getByText("Chcę oddać")).toBeInTheDocument();
  });

  it("shows the three count tiles above the tabs, as in the CLASSIC counts block", () => {
    const reserved = item("9", "SWAP", { term_id: "term-r", reservation: { by_name: "Tomek", by_me: false } });
    const data = pageData({
      exchange: { counts: { GIFT: 3, SWAP: 4, RESERVED: 4 }, items: [item("1", "GIFT"), item("2", "SWAP"), reserved] },
    });
    const { container } = renderWithRouter(<ExchangeBoardBlock data={data} variant="grid2" mode="visitor" />);

    const section = container.querySelector("section")!;
    expect(section).toHaveTextContent(/3\s*Chcę oddać.*4\s*Chcę się zamienić.*4\s*Zarezerwowane.*Wszystkie 11/);
    expect(screen.getByRole("link", { name: /4\s*Zarezerwowane/ })).toHaveAttribute("href", `/${SLUG}/group/g1/term/term-r`);
    expect(within(screen.getByRole("tabpanel")).queryByText("Zarezerwowane")).not.toBeInTheDocument();
  });

  it("wraps the tab strip instead of scrolling it sideways on narrow screens", () => {
    const data = pageData({
      exchange: { counts: { GIFT: 1, SWAP: 1, RESERVED: 1 }, items: [item("1", "GIFT")] },
    });
    renderWithRouter(<ExchangeBoardBlock data={data} variant="grid2" mode="visitor" />);

    const tablist = screen.getByRole("tablist", { name: "Wymiana rzeczy" });
    expect(tablist).toHaveClass("flex", "flex-wrap");
    expect(tablist).not.toHaveClass("overflow-x-auto");
    expect(within(tablist).getAllByRole("tab")).toHaveLength(4);
  });

  it("disables the tab of a mode with no items", () => {
    const data = pageData({
      exchange: { counts: { GIFT: 0, SWAP: 2, RESERVED: 0 }, items: [item("1", "SWAP"), item("2", "SWAP")] },
    });
    renderWithRouter(<ExchangeBoardBlock data={data} variant="grid2" mode="visitor" />);

    const tablist = screen.getByRole("tablist");
    expect(within(tablist).getByRole("tab", { name: /Chcę oddać\s*0/ })).toBeDisabled();
    expect(within(tablist).getByRole("tab", { name: /Chcę się zamienić\s*2/ })).toBeEnabled();
    expect(within(tablist).getByRole("tab", { name: /Zarezerwowane\s*0/ })).toBeDisabled();
  });
});

describe("ExchangeItemCard", () => {
  it("opens the product page from the whole tile, with an intent pill and no pickup chip or date", () => {
    renderWithRouter(<ExchangeItemCard slug={SLUG} item={item("1", "SWAP")} />);

    const card = screen.getByRole("article");
    const links = within(card).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName("Rzecz 1");
    expect(links[0]).toHaveAttribute("href", `/${SLUG}/product/1`);
    expect(links[0]).toHaveClass("after:absolute", "after:inset-0");
    expect(within(card).getByText("Chcę się zamienić")).toHaveClass("bg-accent-soft", "text-accent-fg");
    expect(card).toHaveTextContent("Stan: Dobry");
    expect(card).not.toHaveTextContent(/14 paź/);
  });

  it("renders the thumbnail or a placeholder and never a lister", () => {
    const { unmount } = renderWithRouter(
      <ExchangeItemCard slug={SLUG} item={item("1", "SWAP", { thumb_url: "https://cdn.example/1.jpg" })} />,
    );
    const card = screen.getByRole("article");
    const thumb = card.querySelector("img");
    expect(thumb).toHaveAttribute("src", "https://cdn.example/1.jpg");
    expect(thumb).toHaveAttribute("alt", "");
    expect(card).toHaveTextContent("Chcę się zamienić");
    expect(card).toHaveTextContent("Dobry");
    expect(card).not.toHaveTextContent(/wystawi|dodał|dodała/i);
    unmount();

    renderWithRouter(<ExchangeItemCard slug={SLUG} item={item("2", "GIFT")} />);
    expect(screen.queryByRole("img", { name: "Rzecz 2" })).not.toBeInTheDocument();
    expect(screen.getByRole("article").querySelector("svg")).not.toBeNull();
  });
});

describe("NeededItemsBlock", () => {
  it("links open items and marks claimed ones without a name", () => {
    const needed: OrganizerNeededItem[] = [
      { id: "n1", term_id: "term-a", group_id: "a", name: "Koc piknikowy", claimed: false },
      { id: "n2", term_id: "term-a", group_id: "a", name: "Głośnik", claimed: true },
    ];
    renderWithRouter(
      <NeededItemsBlock data={pageData({ needed_items: needed, circles: [circle("a")] })} variant="list" mode="visitor" />,
    );

    expect(screen.getByRole("heading", { name: "Potrzebne na najbliższe zajęcia" })).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByRole("link", { name: /Zobacz/ })).toHaveAttribute("href", `/${SLUG}/group/a/term/term-a`);
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
    expect(isExchangeCountsEmpty(pageData({ exchange: { counts: { GIFT: 0, SWAP: 1, RESERVED: 0 }, items: [] } }))).toBe(
      false,
    );

    expect(isExchangeBoardEmpty(pageData({ exchange: { counts: { GIFT: 2, SWAP: 0, RESERVED: 0 }, items: [] } }))).toBe(
      true,
    );
    expect(
      isExchangeBoardEmpty(pageData({ exchange: { counts: { GIFT: 1, SWAP: 0, RESERVED: 0 }, items: [item("1", "GIFT")] } })),
    ).toBe(false);

    expect(isNeededItemsEmpty(pageData())).toBe(true);
    expect(
      isNeededItemsEmpty(
        pageData({
          needed_items: [{ id: "n", term_id: "t", group_id: "g", name: "Koc", claimed: false }],
        }),
      ),
    ).toBe(false);
  });
});
