import { render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import type { OrganizationStats, PublicOrganizationResponse } from "../api/organizations";
import { BlockSkeleton } from "../components/shared/BlockSkeleton";
import { EmptyStateBlock } from "../features/organization-public/blocks/EmptyStateBlock";
import { GhostBlock } from "../features/organization-public/blocks/GhostBlock";
import { LayoutRenderer } from "../features/organization-public/LayoutRenderer";
import { isRecommended, LAYOUT_REGISTRY } from "../features/organization-public/layouts/registry";
import type {
  DirectoryStatus,
  OrganizerPageData,
  PageLayoutDefinition,
} from "../features/organization-public/layouts/types";
import { layoutStats } from "./organizationLayoutFixtures";
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

    renderWithRouter(<GhostBlock block="item-stats" slug="rodzinny-grajdolek" unavailable />);

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
  const recommendedKeys = (stats: OrganizationStats | null, status: DirectoryStatus = "ready") =>
    layouts.filter((layout) => isRecommended(layout, stats, status)).map((layout) => layout.key);

  it("shows no badge while loading and recommends LINKS when unavailable or with no meetings and no items", () => {
    expect(recommendedKeys(null, "loading")).toEqual([]);
    expect(recommendedKeys(null, "unavailable")).toEqual(["LINKS"]);
    expect(recommendedKeys(layoutStats())).toEqual(["LINKS"]);
    expect(recommendedKeys(layoutStats({ group_count: 2 }))).toEqual(["LINKS"]);
    expect(recommendedKeys(layoutStats({ item_count: 1 }))).toEqual([]);
  });

  it("recommends SCHEDULE from 3 meetings and EXCHANGE for 4+ items with at most one meeting", () => {
    expect(recommendedKeys(layoutStats({ meeting_count: 3 }))).toEqual(["SCHEDULE"]);
    expect(recommendedKeys(layoutStats({ meeting_count: 2 }))).toEqual([]);
    expect(recommendedKeys(layoutStats({ item_count: 4, meeting_count: 1 }))).toEqual(["EXCHANGE"]);
    expect(recommendedKeys(layoutStats({ item_count: 3, meeting_count: 0 }))).toEqual([]);
    expect(recommendedKeys(layoutStats({ item_count: 9, meeting_count: 5 }))).toEqual(["SCHEDULE"]);
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
      { block: "groups-grid", variant: "cards", when: { minGroups: 2 }, primary: true },
      { block: "groups-grid", variant: "featured", when: { maxGroups: 1 }, primary: true },
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

    rerender(<LayoutRenderer layout={layout} data={unavailable} mode="owner-edit" />);
    const ghosts = container.querySelectorAll("[data-ghost]");
    expect(ghosts).toHaveLength(1);
    const neutralBody = "Nie udało się wczytać danych. Odwiedzający nie widzą tej sekcji.";
    expect(within(ghosts[0] as HTMLElement).getByText(neutralBody)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Brak informacji do pokazania" })).not.toBeInTheDocument();
  });
});
