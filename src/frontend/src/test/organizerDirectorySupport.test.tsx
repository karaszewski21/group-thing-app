import { render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import type { OrganizerPageResponse } from "../api/groups";
import type { PublicOrganizationResponse } from "../api/organizations";
import type { OwnerItemCard, OwnerNearestDate } from "../api/ownerItems";
import { BlockSkeleton } from "../components/shared/BlockSkeleton";
import { EmptyStateBlock } from "../features/organization-public/blocks/EmptyStateBlock";
import { GhostBlock } from "../features/organization-public/blocks/GhostBlock";
import { LayoutRenderer } from "../features/organization-public/LayoutRenderer";
import { isRecommended, LAYOUT_REGISTRY } from "../features/organization-public/layouts/registry";
import type { OrganizerPageData, PageLayoutDefinition } from "../features/organization-public/layouts/types";
import dayjs from "../utils/dayjs";
import { renderWithRoute } from "./renderWithRoute";

const organization: PublicOrganizationResponse = {
  slug: "akademia-orlik",
  name: "Akademia Orlik",
  primary_color: null,
  accent_color: null,
  page_layout: "CLASSIC",
  palette_preset: null,
  description: null,
  logo: null,
  avatar: null,
  cover: null,
  gallery: [],
};

function meeting(id: string, startsAt: string): OwnerNearestDate {
  return {
    kind: "TERM",
    id,
    name: "Orliki 2017",
    starts_at: startsAt,
    location_name: null,
    attendee_count: 12,
    path: `/akademia-orlik/group/g1/term/${id}`,
  };
}

function item(id: string): OwnerItemCard {
  return {
    item_id: id,
    product_name: `Rzecz ${id}`,
    condition: "GOOD",
    mode: "GIFT",
    thumb_url: null,
    added_at: "2026-10-01T10:00:00",
    reservation: null,
  };
}

function directory(overrides: Partial<OrganizerPageResponse> = {}): OrganizerPageResponse {
  return {
    circles: [],
    upcoming_terms: [],
    exchange: { counts: { GIFT: 0, SWAP: 0, RESERVED: 0 }, items: [] },
    needed_items: [],
    upcoming_dates: [],
    recent_items: [],
    owner_nearest: null,
    stats: { circle_count: 0, upcoming_term_count: 0, family_count: null },
    ...overrides,
  };
}

function renderWithRouter(ui: ReactElement) {
  return renderWithRoute(ui, { url: "/" });
}

describe("GhostBlock", () => {
  it("renders a directory ghost with its panel CTA, and the unavailable variant without one", () => {
    const { unmount } = renderWithRouter(<GhostBlock block="upcoming-dates" slug="rodzinny-grajdolek" />);

    expect(screen.getByText("Najbliższe spotkania")).toBeInTheDocument();
    expect(screen.getByText("Tu pokażemy Twoje najbliższe terminy i wydarzenia. Widzisz to tylko Ty.")).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: "Dodaj wydarzenie →" });
    expect(cta).toHaveAttribute("href", "/add/event");
    expect(cta).toHaveClass("min-h-[44px]");
    unmount();

    renderWithRouter(<GhostBlock block="exchange-board" slug="rodzinny-grajdolek" unavailable />);

    expect(screen.getByText("Wymiana rzeczy")).toBeInTheDocument();
    expect(screen.getByText("Nie udało się wczytać danych. Odwiedzający nie widzą tej sekcji.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("EmptyStateBlock", () => {
  it("shows per-layout copy, the EXCHANGE explainer, the unavailable copy and the share button", () => {
    const body = "Zajrzyj tu wkrótce albo udostępnij stronę znajomym.";
    const { rerender } = render(<EmptyStateBlock layoutKey="SCHEDULE" organization={organization} />);
    expect(screen.getByRole("heading", { name: "Brak zaplanowanych spotkań" })).toBeInTheDocument();
    expect(screen.getByText(body)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Udostępnij stronę" })).toBeInTheDocument();
    expect(screen.queryByText("Jak to działa?")).not.toBeInTheDocument();

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
    expect(busy).toHaveTextContent("Ładowanie…");
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

  it("shows no badge while loading and recommends LINKS when unavailable or with no dates and no items", () => {
    expect(recommendedKeys({ organization, directory: null, directoryStatus: "loading" })).toEqual([]);
    expect(recommendedKeys({ organization, directory: null, directoryStatus: "unavailable" })).toEqual(["LINKS"]);
    expect(recommendedKeys({ organization, directory: directory(), directoryStatus: "ready" })).toEqual(["LINKS"]);
    expect(
      recommendedKeys({ organization, directory: directory({ recent_items: [item("i1")] }), directoryStatus: "ready" }),
    ).toEqual([]);
  });

  it("recommends SCHEDULE for 3 dates within 14 days and EXCHANGE for many items with at most one date", () => {
    const soon = (days: number) => dayjs().add(days, "day").format("YYYY-MM-DDTHH:mm:ss");
    const busy = directory({ upcoming_dates: [meeting("t1", soon(1)), meeting("t2", soon(3)), meeting("t3", soon(5))] });
    expect(recommendedKeys({ organization, directory: busy, directoryStatus: "ready" })).toEqual(["SCHEDULE"]);
    const sparse = directory({ upcoming_dates: [meeting("t1", soon(1)), meeting("t2", soon(20)), meeting("t3", soon(30))] });
    expect(recommendedKeys({ organization, directory: sparse, directoryStatus: "ready" })).toEqual([]);

    const items = ["i1", "i2", "i3", "i4"].map(item);
    const stocked = directory({ recent_items: items, upcoming_dates: [meeting("t1", soon(1))] });
    expect(recommendedKeys({ organization, directory: stocked, directoryStatus: "ready" })).toEqual(["EXCHANGE"]);
    expect(
      recommendedKeys({ organization, directory: { ...busy, recent_items: items }, directoryStatus: "ready" }),
    ).toEqual(["SCHEDULE"]);
  });
});

describe("LayoutRenderer directory rules", () => {
  const layout: PageLayoutDefinition = {
    key: "SCHEDULE",
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
    rerender(<LayoutRenderer layout={layout} data={unavailable} mode="visitor" />);
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.getAllByRole("heading", { name: "Brak informacji do pokazania" })).toHaveLength(1);
    expect(container.querySelector("[data-ghost]")).toBeNull();
    expect(screen.getByText("Strona utworzona w Krąg grupy")).toBeInTheDocument();

    rerender(<LayoutRenderer layout={layout} data={unavailable} mode="owner-edit" />);
    const ghosts = container.querySelectorAll("[data-ghost]");
    expect(ghosts).toHaveLength(1);
    const neutralBody = "Nie udało się wczytać danych. Odwiedzający nie widzą tej sekcji.";
    expect(within(ghosts[0] as HTMLElement).getByText(neutralBody)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Brak informacji do pokazania" })).not.toBeInTheDocument();
  });
});
