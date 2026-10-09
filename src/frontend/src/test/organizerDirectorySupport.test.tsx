import { render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { OrganizerCircle, OrganizerPageResponse, OrganizerTerm } from "../api/groups";
import type { PublicOrganizationResponse } from "../api/organizations";
import { BlockSkeleton } from "../pages/organizer/blocks/BlockSkeleton";
import { EmptyStateBlock } from "../pages/organizer/blocks/EmptyStateBlock";
import { GhostBlock } from "../pages/organizer/blocks/GhostBlock";
import { nearestTerm } from "../pages/organizer/blocks/nearestTerm";
import { LayoutRenderer } from "../pages/organizer/LayoutRenderer";
import { isRecommended, LAYOUT_REGISTRY } from "../pages/organizer/layouts/registry";
import type { OrganizerPageData, PageLayoutDefinition } from "../pages/organizer/layouts/types";

const organization: PublicOrganizationResponse = {
  slug: "akademia-orlik",
  name: "Akademia Orlik",
  primary_color: null,
  accent_color: null,
  page_layout: "CLASSIC",
  palette_preset: null,
};

function circle(id: string, nextOccursOn: string | null): OrganizerCircle {
  return {
    id,
    name: `Grupa ${id}`,
    layout_mode: "CIRCLE",
    next_term: nextOccursOn ? { id: `term-${id}`, occurs_on: nextOccursOn, attendee_count: 4 } : null,
    upcoming_term_count: 0,
  };
}

const TERM: OrganizerTerm = {
  term_id: "t1",
  group_id: "g1",
  group_name: "Orliki 2017",
  occurs_on: "2026-10-14T17:00:00",
  description: "Boisko",
  attendee_count: 12,
};

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

function renderWithRouter(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("nearestTerm", () => {
  it("returns the first upcoming term when the 60-day window is not empty", () => {
    expect(nearestTerm(directory({ upcoming_terms: [TERM], circles: [circle("a", "2026-10-01T10:00:00")] }))).toBe(
      TERM,
    );
  });

  it("falls back to the earliest circle next_term, ties broken by circle id", () => {
    const result = nearestTerm(
      directory({
        circles: [
          circle("c", "2027-02-01T10:00:00"),
          circle("b", "2027-01-05T09:00:00"),
          circle("a", "2027-01-05T09:00:00"),
          circle("d", null),
        ],
      }),
    );

    expect(result).toEqual({
      term_id: "term-a",
      group_id: "a",
      group_name: "Grupa a",
      occurs_on: "2027-01-05T09:00:00",
      description: null,
      attendee_count: 4,
    });
  });

  it("returns null when no circle has a next term", () => {
    expect(nearestTerm(directory({ circles: [circle("a", null)] }))).toBeNull();
    expect(nearestTerm(null)).toBeNull();
  });
});

describe("GhostBlock", () => {
  it("renders a directory ghost with its panel CTA, and the unavailable variant without one", () => {
    const { unmount } = renderWithRouter(<GhostBlock block="upcoming-terms" />);

    expect(screen.getByText("Najbliższe terminy")).toBeInTheDocument();
    expect(screen.getByText("Tu pokażemy Twoje najbliższe zajęcia. Widzisz to tylko Ty.")).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: "Dodaj termin →" });
    expect(cta).toHaveAttribute("href", "/panel/spotkania");
    expect(cta).toHaveClass("min-h-[44px]");
    unmount();

    renderWithRouter(<GhostBlock block="exchange-board" unavailable />);

    expect(screen.getByText("Wymiana rzeczy")).toBeInTheDocument();
    expect(screen.getByText("Nie udało się wczytać danych. Odwiedzający nie widzą tej sekcji.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("EmptyStateBlock", () => {
  it("shows per-layout copy, the EXCHANGE explainer, the unavailable copy and the share button", () => {
    const body = "Zajrzyj tu wkrótce albo udostępnij stronę znajomym.";
    const { rerender } = render(<EmptyStateBlock layoutKey="SCHEDULE" organization={organization} />);
    expect(screen.getByRole("heading", { name: "Brak zaplanowanych zajęć" })).toBeInTheDocument();
    expect(screen.getByText(body)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Udostępnij stronę" })).toBeInTheDocument();
    expect(screen.queryByText("Jak to działa?")).not.toBeInTheDocument();

    rerender(<EmptyStateBlock layoutKey="CIRCLES" organization={organization} />);
    expect(screen.getByRole("heading", { name: "Brak grup do pokazania" })).toBeInTheDocument();

    rerender(<EmptyStateBlock layoutKey="EXCHANGE" organization={organization} />);
    expect(screen.getByRole("heading", { name: "Na razie nic tu nie ma" })).toBeInTheDocument();
    expect(screen.getByText("Jak to działa?").closest("details")).not.toBeNull();

    rerender(<EmptyStateBlock layoutKey="EXCHANGE" organization={organization} unavailable />);
    expect(screen.getByRole("heading", { name: "Brak informacji do pokazania" })).toBeInTheDocument();
    expect(screen.getByText(body)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Udostępnij stronę" })).toBeInTheDocument();
  });
});

describe("BlockSkeleton", () => {
  it.each(["rows", "grid"] as const)("renders %s as aria-hidden pulse bars in an aria-busy container", (shape) => {
    const { container } = render(<BlockSkeleton shape={shape} />);

    const busy = container.querySelector('[aria-busy="true"]');
    expect(busy).not.toBeNull();
    const bars = busy!.querySelectorAll(".animate-pulse");
    expect(bars.length).toBeGreaterThan(1);
    for (const bar of bars) {
      expect(bar).toHaveAttribute("aria-hidden", "true");
      expect(bar).toHaveClass("bg-line/60", "motion-reduce:animate-none");
    }
  });
});

describe("isRecommended", () => {
  const layouts = Object.values(LAYOUT_REGISTRY);
  const recommendedKeys = (data: OrganizerPageData) =>
    layouts.filter((layout) => isRecommended(layout, data)).map((layout) => layout.key);

  it("shows no badge while loading and recommends LINKS when unavailable or without circles", () => {
    expect(recommendedKeys({ organization, directory: null, directoryStatus: "loading" })).toEqual([]);
    expect(recommendedKeys({ organization, directory: null, directoryStatus: "unavailable" })).toEqual(["LINKS"]);
    expect(recommendedKeys({ organization, directory: directory(), directoryStatus: "ready" })).toEqual(["LINKS"]);
    expect(
      recommendedKeys({ organization, directory: directory({ circles: [circle("a", null)] }), directoryStatus: "ready" }),
    ).not.toContain("LINKS");
  });
});

describe("LayoutRenderer directory rules", () => {
  const layout: PageLayoutDefinition = {
    key: "CIRCLES",
    label: "Test",
    description: "",
    thumbnail: { src: "", alt: "" },
    frame: "column",
    blocks: [
      { block: "hero", variant: "cover" },
      { block: "circles-grid", variant: "cards", when: { minCircles: 2 }, primary: true },
      { block: "circles-grid", variant: "featured", when: { maxCircles: 1 }, primary: true },
      { block: "footer" },
    ],
  };

  it("shows one skeleton while loading, and hides or ghosts the directory when unavailable", () => {
    const { container, rerender } = renderWithRouter(
      <LayoutRenderer layout={layout} data={{ organization, directory: null, directoryStatus: "loading" }} mode="visitor" />,
    );
    expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Akademia Orlik" })).toBeInTheDocument();

    const unavailable: OrganizerPageData = { organization, directory: null, directoryStatus: "unavailable" };
    rerender(
      <MemoryRouter>
        <LayoutRenderer layout={layout} data={unavailable} mode="visitor" />
      </MemoryRouter>,
    );
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.getAllByRole("heading", { name: "Brak informacji do pokazania" })).toHaveLength(1);
    expect(container.querySelector("[data-ghost]")).toBeNull();
    expect(screen.getByText("Strona utworzona w domena.pl")).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <LayoutRenderer layout={layout} data={unavailable} mode="owner-edit" />
      </MemoryRouter>,
    );
    const ghosts = container.querySelectorAll("[data-ghost]");
    expect(ghosts).toHaveLength(1);
    const neutralBody = "Nie udało się wczytać danych. Odwiedzający nie widzą tej sekcji.";
    expect(within(ghosts[0] as HTMLElement).getByText(neutralBody)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Brak informacji do pokazania" })).not.toBeInTheDocument();
  });
});
