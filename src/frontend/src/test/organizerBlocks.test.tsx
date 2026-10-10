import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as groupsApi from "../api/groups";
import type { OrganizerCircle, OrganizerPageResponse, OrganizerTerm } from "../api/groups";
import type { PublicOrganizationResponse } from "../api/organizations";
import type { Page } from "../api/pagination";
import { AgendaBlock } from "../pages/organizer/blocks/AgendaBlock";
import { NextTermCtaBlock } from "../pages/organizer/blocks/NextTermCtaBlock";
import { isStatsEmpty, StatsBlock } from "../pages/organizer/blocks/StatsBlock";
import { UpcomingTermsBlock } from "../pages/organizer/blocks/UpcomingTermsBlock";
import type { OrganizerPageData } from "../pages/organizer/layouts/types";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/groups", () => ({
  getOrganizerTerms: vi.fn(),
}));

const SLUG = "akademia-orlik";

const organization: PublicOrganizationResponse = {
  slug: SLUG,
  name: "Akademia Orlik",
  primary_color: null,
  accent_color: null,
  page_layout: "SCHEDULE",
  palette_preset: null,
};

function term(id: string, occursOn: string, overrides: Partial<OrganizerTerm> = {}): OrganizerTerm {
  return {
    term_id: id,
    group_id: "g1",
    group_name: "Orliki 2017",
    occurs_on: occursOn,
    description: null,
    attendee_count: 12,
    ...overrides,
  };
}

function circle(id: string, name: string, nextOccursOn: string | null): OrganizerCircle {
  return {
    id,
    name,
    layout_mode: "CIRCLE",
    next_term: nextOccursOn ? { id: `next-${id}`, occurs_on: nextOccursOn, attendee_count: 5 } : null,
    upcoming_term_count: 1,
  };
}

function pageData(overrides: Partial<OrganizerPageResponse> = {}): OrganizerPageData {
  return {
    organization,
    directoryStatus: "ready",
    directory: {
      circles: [],
      upcoming_terms: [],
      exchange: { counts: { GIFT: 0, SWAP: 0, LEND: 0 }, items: [] },
      needed_items: [],
      stats: { circle_count: 0, upcoming_term_count: 0, family_count: null },
      ...overrides,
    },
  };
}

function termsPage(items: OrganizerTerm[], page: number, total: number): Page<OrganizerTerm> {
  return { items, total, page, size: 20 };
}

function renderWithProviders(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>, { wrapper: createQueryWrapper() });
}

const TWO_CIRCLES = [circle("g1", "Orliki 2017", "2026-10-13T17:00:00"), circle("g2", "Młodziki 2015", null)];

beforeEach(() => {
  vi.resetAllMocks();
});

describe("StatsBlock", () => {
  it("renders a tile per non-empty stat with Polish plurals and is empty below 2 tiles", () => {
    renderWithProviders(
      <StatsBlock
        data={pageData({ stats: { circle_count: 3, upcoming_term_count: 1, family_count: 35 } })}
        mode="visitor"
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("grupy")).toBeInTheDocument();
    expect(screen.getByText("termin w 60 dni")).toBeInTheDocument();
    expect(screen.getByText("rodzin")).toBeInTheDocument();

    expect(isStatsEmpty(pageData({ stats: { circle_count: 1, upcoming_term_count: 0, family_count: null } }))).toBe(
      true,
    );
    expect(isStatsEmpty(pageData({ stats: { circle_count: 1, upcoming_term_count: 0, family_count: 3 } }))).toBe(
      false,
    );
  });
});

describe("UpcomingTermsBlock", () => {
  it("links rows to terms, counts the total link only when more exist, and falls back to the nearest term", () => {
    const terms = [term("t1", "2026-10-14T16:30:00"), term("t2", "2026-10-16T10:00:00", { attendee_count: 0 })];
    const { unmount } = renderWithProviders(
      <UpcomingTermsBlock
        data={pageData({ upcoming_terms: terms, stats: { circle_count: 1, upcoming_term_count: 9, family_count: null } })}
        variant="list"
        mode="visitor"
      />,
    );

    expect(screen.getByRole("heading", { name: "Najbliższe terminy" })).toBeInTheDocument();
    const rows = screen.getAllByRole("link").filter((link) => link.getAttribute("href")?.includes("/term/"));
    expect(rows.map((row) => row.getAttribute("href"))).toEqual([
      `/${SLUG}/grupa/g1/term/t1`,
      `/${SLUG}/grupa/g1/term/t2`,
    ]);
    expect(within(rows[0]).getByText("Śr · 16:30 · zapisanych: 12")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Pt · 10:00")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Wszystkie terminy (9) →" })).toHaveAttribute("href", `/${SLUG}/terminy`);
    unmount();

    renderWithProviders(
      <UpcomingTermsBlock
        data={pageData({ upcoming_terms: terms, stats: { circle_count: 1, upcoming_term_count: 2, family_count: null } })}
        variant="list"
        mode="visitor"
      />,
    );
    expect(screen.queryByText(/Wszystkie terminy/)).not.toBeInTheDocument();
    cleanup();

    renderWithProviders(
      <UpcomingTermsBlock
        data={pageData({ circles: [circle("g2", "Młodziki 2015", "2027-01-05T09:00:00")] })}
        variant="list"
        mode="visitor"
      />,
    );

    expect(screen.getByRole("link", { name: /Młodziki 2015/ })).toHaveAttribute("href", `/${SLUG}/grupa/g2/term/next-g2`);
    expect(screen.getByRole("link", { name: "Wszystkie terminy →" })).toHaveAttribute("href", `/${SLUG}/terminy`);
  });

  it("compact renders at most 3 date chips", () => {
    const terms = ["14", "16", "18", "21"].map((day) => term(`t${day}`, `2026-10-${day}T10:00:00`));
    renderWithProviders(<UpcomingTermsBlock data={pageData({ upcoming_terms: terms })} variant="compact" mode="visitor" />);

    expect(screen.getByRole("heading", { name: "Najbliższe spotkania" })).toBeInTheDocument();
    const chips = screen.getAllByRole("link");
    expect(chips).toHaveLength(3);
    expect(chips[0]).toHaveTextContent("Śr 14 paź");
    expect(chips[0]).toHaveAttribute("href", `/${SLUG}/grupa/g1/term/t14`);
  });
});

describe("NextTermCtaBlock", () => {
  it("renders the nearest term's date, count and sign-up link", () => {
    renderWithProviders(
      <NextTermCtaBlock data={pageData({ upcoming_terms: [term("t1", "2026-10-14T17:00:00")] })} mode="visitor" />,
    );

    expect(screen.getByText("NAJBLIŻSZE ZAJĘCIA")).toBeInTheDocument();
    expect(screen.getByText("Orliki 2017")).toBeInTheDocument();
    expect(screen.getByText("środa, 14 października · 17:00")).toBeInTheDocument();
    expect(screen.getByText("zapisanych: 12")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zobacz i zapisz się →" })).toHaveAttribute(
      "href",
      `/${SLUG}/grupa/g1/term/t1`,
    );
  });
});

describe("AgendaBlock", () => {
  it("groups terms by day under uppercase headers and loads the next page on demand", async () => {
    const first = [
      term("t1", "2026-10-14T17:00:00"),
      term("t2", "2026-10-14T18:15:00", { group_id: "g2", group_name: "Młodziki 2015", description: "Turniej" }),
      term("t3", "2026-10-16T17:00:00", { attendee_count: 0 }),
    ];
    vi.mocked(groupsApi.getOrganizerTerms).mockImplementation(async (_slug, page) =>
      page === 1 ? termsPage(first, 1, 21) : termsPage([term("t4", "2026-10-18T10:00:00")], 2, 21),
    );

    renderWithProviders(<AgendaBlock data={pageData({ circles: TWO_CIRCLES })} mode="visitor" />);

    expect(screen.getByRole("heading", { name: "Plan zajęć" })).toBeInTheDocument();
    const wednesday = await screen.findByRole("heading", { level: 3, name: "środa, 14 października" });
    expect(wednesday).toHaveClass("uppercase");
    expect(screen.getByRole("heading", { level: 3, name: "piątek, 16 października" })).toBeInTheDocument();
    expect(screen.getByText("Turniej")).toBeInTheDocument();
    const row = screen.getByRole("link", { name: /Młodziki 2015/ });
    expect(row).toHaveAttribute("href", `/${SLUG}/grupa/g2/term/t2`);
    expect(row).toHaveTextContent("18:15");
    expect(row).toHaveTextContent("zapisanych 12");

    fireEvent.click(screen.getByRole("button", { name: "Pokaż kolejne terminy" }));

    expect(await screen.findByRole("heading", { level: 3, name: "niedziela, 18 października" })).toBeInTheDocument();
    expect(groupsApi.getOrganizerTerms).toHaveBeenLastCalledWith(SLUG, 2, undefined);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Pokaż kolejne terminy" })).not.toBeInTheDocument());
    expect(screen.getByText("Wczytano 1 kolejny termin")).toBeInTheDocument();
  });

  it("filters by circle through a radiogroup with arrow-key focus", async () => {
    vi.mocked(groupsApi.getOrganizerTerms).mockResolvedValue(termsPage([term("t1", "2026-10-14T17:00:00")], 1, 1));

    renderWithProviders(<AgendaBlock data={pageData({ circles: TWO_CIRCLES })} mode="visitor" />);

    const group = screen.getByRole("radiogroup");
    const chips = within(group).getAllByRole("radio");
    expect(chips.map((chip) => chip.textContent)).toEqual(["Wszystkie", "Orliki 2017", "Młodziki 2015"]);
    expect(chips[0]).toHaveAttribute("aria-checked", "true");
    expect(chips[1]).toHaveAttribute("tabindex", "-1");

    chips[0].focus();
    fireEvent.keyDown(chips[0], { key: "ArrowRight" });

    expect(chips[1]).toHaveFocus();
    expect(chips[1]).toHaveAttribute("aria-checked", "true");
    expect(chips[1]).toHaveAttribute("tabindex", "0");
    await waitFor(() => expect(groupsApi.getOrganizerTerms).toHaveBeenLastCalledWith(SLUG, 1, "g1"));
  });

  it("shows a first-page error with a retry that refetches", async () => {
    vi.mocked(groupsApi.getOrganizerTerms)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(termsPage([term("t1", "2026-10-14T17:00:00")], 1, 1));

    renderWithProviders(<AgendaBlock data={pageData({ circles: TWO_CIRCLES })} mode="visitor" />);

    expect(await screen.findByText("Nie udało się wczytać terminów.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));

    expect(await screen.findByRole("heading", { level: 3, name: "środa, 14 października" })).toBeInTheDocument();
    expect(groupsApi.getOrganizerTerms).toHaveBeenCalledTimes(2);
  });

  it("offers to show every circle when a filter finds no terms", async () => {
    vi.mocked(groupsApi.getOrganizerTerms).mockImplementation(async (_slug, _page, groupId) =>
      groupId === "g2" ? termsPage([], 1, 0) : termsPage([term("t1", "2026-10-14T17:00:00")], 1, 1),
    );

    renderWithProviders(<AgendaBlock data={pageData({ circles: TWO_CIRCLES })} mode="visitor" />);
    await screen.findByRole("heading", { level: 3, name: "środa, 14 października" });

    fireEvent.click(screen.getByRole("radio", { name: "Młodziki 2015" }));

    expect(await screen.findByText("Brak zaplanowanych zajęć")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pokaż wszystkie grupy" }));

    expect(await screen.findByRole("heading", { level: 3, name: "środa, 14 października" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Wszystkie" })).toHaveAttribute("aria-checked", "true");
  });
});
