import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithRoute } from "./renderWithRoute";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { OrganizationGroup, OrganizationLayoutResponse, PublicOrganizationResponse } from "../api/organizations";
import { GroupsGridBlock, isGroupsGridEmpty } from "../features/organization-public/blocks/GroupsGridBlock";
import { isItemStatsEmpty, ItemStatsBlock } from "../features/organization-public/blocks/ItemStatsBlock";
import { isMeetingLinksEmpty, MeetingLinksBlock } from "../features/organization-public/blocks/MeetingLinksBlock";
import type { OrganizerPageData } from "../features/organization-public/layouts/types";
import { ExchangeModeTabs } from "../features/items/blocks/ExchangeModeTabs";
import { classicLayout, exchangeLayout, layoutGroup, meetingLink, scheduleLayout } from "./organizationLayoutFixtures";

const SLUG = "akademia-orlik";

const organization: PublicOrganizationResponse = {
  slug: SLUG,
  name: "Akademia Orlik",
  primary_color: null,
  accent_color: null,
  page_layout: "SCHEDULE",
  palette_preset: null,
  description: null,
  logo: null,
  avatar: null,
  cover: null,
  gallery: [],
};

function group(id: string, overrides: Partial<OrganizationGroup> = {}): OrganizationGroup {
  return layoutGroup(id, {
    next_term: { id: `term-${id}`, occurs_on: "2026-10-15T09:30:00", attendee_count: 7 },
    upcoming_term_count: 4,
    ...overrides,
  });
}

function pageData(directory: OrganizationLayoutResponse): OrganizerPageData {
  return { organization, directory, directoryStatus: "ready" };
}

function renderWithRouter(ui: ReactElement) {
  return renderWithRoute(ui, { url: "/" });
}

describe("GroupsGridBlock", () => {
  it("cards link to the next term and to the group's terms page, never to a filtered list or all meetings", () => {
    const data = pageData(
      scheduleLayout({ groups: [group("a", { name: "Maluchy 0-2" }), group("b", { name: "Rytmika", next_term: null })] }),
    );
    renderWithRouter(<GroupsGridBlock data={data} variant="cards" mode="visitor" />);

    expect(screen.getByRole("heading", { name: "Nasze grupy" })).toBeInTheDocument();
    const withTerm = screen.getByRole("link", { name: "Zobacz najbliższy termin grupy Maluchy 0-2" });
    expect(withTerm).toHaveTextContent("Zobacz najbliższy termin →");
    expect(withTerm).toHaveAttribute("href", `/${SLUG}/group/a/term/term-a`);
    const withTermCard = withTerm.closest("li")!;
    expect(withTermCard).toHaveTextContent("najbliższy: Cz 15 paź, 09:30");
    expect(withTermCard).toHaveTextContent("4 terminy · zapisanych: 7");
    expect(within(withTermCard).getByRole("img", { name: "Zapisanych 7 rodzin" })).toBeInTheDocument();

    const withoutTermCard = screen.getByRole("heading", { name: "Rytmika" }).closest("li")!;
    expect(withoutTermCard).toHaveTextContent("brak zaplanowanych terminów");
    expect(within(withoutTermCard).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      `/${SLUG}/group/b/terms`,
    ]);
    expect(document.querySelector('a[href*="group_id="]')).toBeNull();
    expect(screen.getByRole("link", { name: "Wszystkie terminy grupy Maluchy 0-2" })).toHaveAttribute(
      "href",
      `/${SLUG}/group/a/terms`,
    );
    expect(screen.queryByRole("link", { name: "Wszystkie spotkania →" })).not.toBeInTheDocument();
  });

  it("labels each card with its group layout: circle, pitch or table", () => {
    const data = pageData(
      scheduleLayout({
        groups: [
          group("a", { layout_mode: "CIRCLE" }),
          group("b", { layout_mode: "PITCH" }),
          group("c", { layout_mode: "TABLE" }),
        ],
      }),
    );
    renderWithRouter(<GroupsGridBlock data={data} variant="cards" mode="visitor" />);

    const cards = screen.getAllByRole("listitem");
    ["Krąg", "Boisko", "Stół"].forEach((label, index) => {
      expect(within(cards[index]).getByText(label)).toBeInTheDocument();
    });
  });

  it("featured renders an anonymous seat visual capped at 16 seats, and none at 0 attendees", () => {
    const busy = group("a", {
      name: "Orliki 2017",
      layout_mode: "PITCH",
      next_term: { id: "t1", occurs_on: "2026-10-14T17:00:00", attendee_count: 20 },
    });
    const { unmount } = renderWithRouter(
      <GroupsGridBlock data={pageData(scheduleLayout({ groups: [busy] }))} variant="featured" mode="visitor" />,
    );

    expect(screen.getByRole("heading", { name: "Nasza grupa" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Wszystkie spotkania →" })).not.toBeInTheDocument();
    const visual = screen.getByRole("img", { name: "Zapisanych 20 rodzin" });
    expect(visual.querySelectorAll("[data-seat]")).toHaveLength(16);
    expect(visual).toHaveTextContent("+4");
    expect(screen.getByRole("link", { name: "Zobacz najbliższy termin grupy Orliki 2017" })).toHaveAttribute(
      "href",
      `/${SLUG}/group/a/term/t1`,
    );
    unmount();

    const quiet = group("a", { next_term: { id: "t1", occurs_on: "2026-10-14T17:00:00", attendee_count: 0 } });
    renderWithRouter(<GroupsGridBlock data={pageData(scheduleLayout({ groups: [quiet] }))} variant="featured" mode="visitor" />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("MeetingLinksBlock", () => {
  it("shows each meeting as its kind and date only, linking to its page", () => {
    const data = pageData(
      exchangeLayout({
        term_links: [
          meetingLink(`/${SLUG}/group/g1/term/t1`, "2026-10-14T17:00:00"),
          meetingLink(`/${SLUG}/event/e1`, "2026-10-17T10:00:00", "EVENT"),
        ],
      }),
    );
    renderWithRouter(<MeetingLinksBlock data={data} mode="visitor" />);

    const chips = within(screen.getByRole("list")).getAllByRole("link");
    expect(chips.map((chip) => chip.textContent)).toEqual(["Zajęcia Śr 14 paź, 17:00›", "Wydarzenie So 17 paź, 10:00›"]);
    expect(chips[1]).toHaveAttribute("href", `/${SLUG}/event/e1`);
    expect(chips[0]).toHaveClass("min-h-[44px]");
  });
});

describe("ItemStatsBlock", () => {
  it("shows the available item count per mode, both tiles leading to the items page", () => {
    renderWithRouter(<ItemStatsBlock data={pageData(scheduleLayout({ item_stats: { GIFT: 0, SWAP: 2 } }))} mode="visitor" />);

    expect(screen.getByRole("link", { name: "0 Chcę oddać" })).toHaveAttribute("href", `/${SLUG}/items`);
    expect(screen.getByRole("link", { name: "2 Chcę się zamienić" })).toHaveAttribute("href", `/${SLUG}/items`);
    expect(screen.getByRole("link", { name: "Wszystkie rzeczy →" })).toHaveAttribute("href", `/${SLUG}/items`);
  });
});

describe("group and item isEmpty predicates", () => {
  it("hide each block exactly when its layout's data is empty or absent", () => {
    expect(isGroupsGridEmpty(pageData(scheduleLayout()))).toBe(true);
    expect(isGroupsGridEmpty(pageData(scheduleLayout({ groups: [group("a")] })))).toBe(false);
    expect(isGroupsGridEmpty(pageData(classicLayout()))).toBe(true);

    expect(isItemStatsEmpty(pageData(scheduleLayout()))).toBe(true);
    expect(isItemStatsEmpty(pageData(scheduleLayout({ item_stats: { GIFT: 1, SWAP: 0 } })))).toBe(false);
    expect(isItemStatsEmpty(pageData(exchangeLayout()))).toBe(true);

    expect(isMeetingLinksEmpty(pageData(exchangeLayout()))).toBe(true);
    expect(isMeetingLinksEmpty(pageData(exchangeLayout({ term_links: [meetingLink("/x", "2026-10-14T17:00:00")] })))).toBe(
      false,
    );
  });
});

describe("ExchangeModeTabs", () => {
  function renderTabs(counts: { GIFT: number; SWAP: number; RESERVED?: number }, onSelect = vi.fn()) {
    renderWithRouter(
      <ExchangeModeTabs
        counts={counts}
        selected="ALL"
        onSelect={onSelect}
        allLabel="Wszystkie"
        ariaLabel="Rzeczy"
        tabId={(filter) => `tab-${filter}`}
        panelId="panel"
      />,
    );
    return within(screen.getByRole("tablist", { name: "Rzeczy" }));
  }

  it("wraps the tab strip, adds the reserved tab only with its count and disables empty modes", () => {
    const onSelect = vi.fn();
    const tablist = renderTabs({ GIFT: 0, SWAP: 2, RESERVED: 1 }, onSelect);

    expect(screen.getByRole("tablist")).toHaveClass("flex", "flex-wrap");
    expect(tablist.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Wszystkie 3",
      "Chcę oddać 0",
      "Chcę się zamienić 2",
      "Zarezerwowane 1",
    ]);
    expect(tablist.getByRole("tab", { name: /Chcę oddać/ })).toBeDisabled();
    fireEvent.click(tablist.getByRole("tab", { name: /Chcę się zamienić/ }));
    expect(onSelect).toHaveBeenCalledWith("SWAP");
  });
});
