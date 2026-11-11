import { cleanup, screen, within } from "@testing-library/react";
import { renderWithRoute } from "./renderWithRoute";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationStats, PublicOrganizationResponse } from "../api/organizations";
import type { OwnerNearestDate } from "../api/ownerItems";
import { NextDateCtaBlock } from "../features/organization-public/blocks/NextDateCtaBlock";
import { isStatsEmpty, StatsBlock } from "../features/organization-public/blocks/StatsBlock";
import { isUpcomingDatesEmpty, UpcomingDatesBlock } from "../features/organization-public/blocks/UpcomingDatesBlock";
import type { OrganizerPageData } from "../features/organization-public/layouts/types";
import { scheduleLayout } from "./organizationLayoutFixtures";
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
  avatar: null,
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

function pageData(
  overrides: { upcoming_terms?: OwnerNearestDate[]; stats?: OrganizationStats } = {},
): OrganizerPageData {
  return { organization, directoryStatus: "ready", directory: scheduleLayout(overrides) };
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
  it("renders a linked tile per non-zero count with Polish plurals and is empty when all are zero", () => {
    renderWithProviders(
      <StatsBlock data={pageData({ stats: { group_count: 3, meeting_count: 1, item_count: 25 } })} mode="visitor" />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "3 grupy" })).toHaveAttribute("href", `/${SLUG}/meetings`);
    expect(screen.getByRole("link", { name: "1 spotkanie" })).toHaveAttribute("href", `/${SLUG}/meetings`);
    expect(screen.getByRole("link", { name: "25 rzeczy" })).toHaveAttribute("href", `/${SLUG}/items`);
    cleanup();

    renderWithProviders(
      <StatsBlock data={pageData({ stats: { group_count: 1, meeting_count: 0, item_count: 0 } })} mode="visitor" />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(isStatsEmpty(pageData({ stats: { group_count: 1, meeting_count: 0, item_count: 0 } }))).toBe(false);
    expect(isStatsEmpty(pageData())).toBe(true);
  });
});

describe("UpcomingDatesBlock", () => {
  it("lists terms and events with their kind, place and sign-ups and links to all meetings", () => {
    const dates = [meeting("t1", "2026-10-14T16:30:00"), EVENT];
    renderWithProviders(<UpcomingDatesBlock data={pageData({ upcoming_terms: dates })} variant="list" mode="visitor" />);

    expect(screen.getByRole("heading", { name: "Najbliższe spotkania" })).toBeInTheDocument();
    const rows = screen.getAllByRole("link").filter((link) => link.getAttribute("href") !== `/${SLUG}/meetings`);
    expect(rows.map((row) => row.getAttribute("href"))).toEqual([`/${SLUG}/group/g1/term/t1`, `/${SLUG}/event/e1`]);
    expect(within(rows[0]).getByText("Termin · Śr 16:30 · zapisanych: 12")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Piknik rodzinny")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Wydarzenie · Pt 10:00 · Gdańsk, Parkowa 1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Wszystkie spotkania →" })).toHaveAttribute("href", `/${SLUG}/meetings`);
  });

  it("after-next skips the first date and keeps only the link when it was the only one", () => {
    const { unmount } = renderWithProviders(
      <UpcomingDatesBlock
        data={pageData({ upcoming_terms: [meeting("t1", "2026-10-14T16:30:00"), EVENT] })}
        variant="after-next"
        mode="visitor"
      />,
    );

    expect(screen.getByRole("heading", { name: "Kolejne spotkania" })).toBeInTheDocument();
    expect(screen.queryByText("Orliki 2017")).not.toBeInTheDocument();
    expect(screen.getByText("Piknik rodzinny")).toBeInTheDocument();
    unmount();

    renderWithProviders(
      <UpcomingDatesBlock data={pageData({ upcoming_terms: [EVENT] })} variant="after-next" mode="visitor" />,
    );
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([`/${SLUG}/meetings`]);
    expect(isUpcomingDatesEmpty(pageData())).toBe(true);
    expect(isUpcomingDatesEmpty(pageData({ upcoming_terms: [EVENT] }))).toBe(false);
  });
});

describe("NextDateCtaBlock", () => {
  it("renders the nearest term's date, count and sign-up link", () => {
    renderWithProviders(
      <NextDateCtaBlock data={pageData({ upcoming_terms: [meeting("t1", "2026-10-14T17:00:00"), EVENT] })} mode="visitor" />,
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

    renderWithProviders(<NextDateCtaBlock data={pageData({ upcoming_terms: [EVENT] })} mode="visitor" />);
    expect(screen.getByText("NAJBLIŻSZE WYDARZENIE")).toBeInTheDocument();
    expect(screen.getByText("Gdańsk, Parkowa 1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zobacz i zapisz się →" })).toHaveAttribute("href", `/${SLUG}/event/e1`);
  });
});
