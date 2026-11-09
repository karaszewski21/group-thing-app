import { cleanup, screen, within } from "@testing-library/react";
import { renderWithRoute } from "./renderWithRoute";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizerPageResponse } from "../api/groups";
import type { PublicOrganizationResponse } from "../api/organizations";
import type { OwnerNearestDate } from "../api/ownerItems";
import { NextDateCtaBlock } from "../features/owner-page/blocks/NextDateCtaBlock";
import { isStatsEmpty, StatsBlock } from "../features/owner-page/blocks/StatsBlock";
import { isUpcomingDatesEmpty, UpcomingDatesBlock } from "../features/owner-page/blocks/UpcomingDatesBlock";
import type { OrganizerPageData } from "../features/owner-page/layouts/types";
import { createQueryWrapper } from "./queryClient";

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
  cover: null,
  gallery: [],
};

function meeting(id: string, startsAt: string, overrides: Partial<OwnerNearestDate> = {}): OwnerNearestDate {
  return {
    kind: "TERM",
    id,
    name: "Orliki 2017",
    starts_at: startsAt,
    location_name: null,
    attendee_count: 12,
    path: `/${SLUG}/group/g1/term/${id}`,
    ...overrides,
  };
}

function pageData(overrides: Partial<OrganizerPageResponse> = {}): OrganizerPageData {
  return {
    organization,
    directoryStatus: "ready",
    directory: {
      circles: [],
      upcoming_terms: [],
      exchange: { counts: { GIFT: 0, SWAP: 0, RESERVED: 0 }, items: [] },
      needed_items: [],
      upcoming_dates: [],
      recent_items: [],
      owner_nearest: null,
      stats: { circle_count: 0, upcoming_term_count: 0, family_count: null },
      ...overrides,
    },
  };
}

function renderWithProviders(ui: ReactElement) {
  return renderWithRoute(ui, { url: "/", wrapper: createQueryWrapper() });
}

const EVENT = meeting("e1", "2026-10-16T10:00:00", {
  kind: "EVENT",
  name: "Piknik rodzinny",
  location_name: "Gdańsk, Parkowa 1",
  attendee_count: 0,
  path: `/${SLUG}/event/e1`,
});

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

describe("UpcomingDatesBlock", () => {
  it("lists terms and events with their kind, place and sign-ups and links to all meetings", () => {
    const dates = [meeting("t1", "2026-10-14T16:30:00"), EVENT];
    renderWithProviders(<UpcomingDatesBlock data={pageData({ upcoming_dates: dates })} variant="list" mode="visitor" />);

    expect(screen.getByRole("heading", { name: "Najbliższe spotkania" })).toBeInTheDocument();
    const rows = screen.getAllByRole("link").filter((link) => link.getAttribute("href") !== `/${SLUG}/meetings`);
    expect(rows.map((row) => row.getAttribute("href"))).toEqual([`/${SLUG}/group/g1/term/t1`, `/${SLUG}/event/e1`]);
    expect(within(rows[0]).getByText("Termin · Śr 16:30 · zapisanych: 12")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Piknik rodzinny")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Wydarzenie · Pt 10:00 · Gdańsk, Parkowa 1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Wszystkie spotkania →" })).toHaveAttribute("href", `/${SLUG}/meetings`);
  });

  it("after-next skips the first date and renders nothing when it was the only one", () => {
    const { unmount } = renderWithProviders(
      <UpcomingDatesBlock
        data={pageData({ upcoming_dates: [meeting("t1", "2026-10-14T16:30:00"), EVENT] })}
        variant="after-next"
        mode="visitor"
      />,
    );

    expect(screen.getByRole("heading", { name: "Kolejne spotkania" })).toBeInTheDocument();
    expect(screen.queryByText("Orliki 2017")).not.toBeInTheDocument();
    expect(screen.getByText("Piknik rodzinny")).toBeInTheDocument();
    unmount();

    const { container } = renderWithProviders(
      <UpcomingDatesBlock data={pageData({ upcoming_dates: [EVENT] })} variant="after-next" mode="visitor" />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(isUpcomingDatesEmpty(pageData())).toBe(true);
    expect(isUpcomingDatesEmpty(pageData({ upcoming_dates: [EVENT] }))).toBe(false);
  });

  it("compact renders at most 3 date chips", () => {
    const dates = ["14", "16", "18", "21"].map((day) => meeting(`t${day}`, `2026-10-${day}T10:00:00`));
    renderWithProviders(<UpcomingDatesBlock data={pageData({ upcoming_dates: dates })} variant="compact" mode="visitor" />);

    const chips = screen.getAllByRole("link").filter((link) => link.getAttribute("href") !== `/${SLUG}/meetings`);
    expect(chips).toHaveLength(3);
    expect(chips[0]).toHaveTextContent("Śr 14 paź");
    expect(chips[0]).toHaveAttribute("href", `/${SLUG}/group/g1/term/t14`);
  });
});

describe("NextDateCtaBlock", () => {
  it("renders the nearest term's date, count and sign-up link", () => {
    renderWithProviders(
      <NextDateCtaBlock data={pageData({ upcoming_dates: [meeting("t1", "2026-10-14T17:00:00"), EVENT] })} mode="visitor" />,
    );

    expect(screen.getByText("NAJBLIŻSZE ZAJĘCIA")).toBeInTheDocument();
    expect(screen.getByText("Orliki 2017")).toBeInTheDocument();
    expect(screen.getByText("środa, 14 października · 17:00")).toBeInTheDocument();
    expect(screen.getByText("zapisanych: 12")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zobacz i zapisz się →" })).toHaveAttribute(
      "href",
      `/${SLUG}/group/g1/term/t1`,
    );
    cleanup();

    renderWithProviders(<NextDateCtaBlock data={pageData({ upcoming_dates: [EVENT] })} mode="visitor" />);
    expect(screen.getByText("NAJBLIŻSZE WYDARZENIE")).toBeInTheDocument();
    expect(screen.getByText("Gdańsk, Parkowa 1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zobacz i zapisz się →" })).toHaveAttribute("href", `/${SLUG}/event/e1`);
  });
});
