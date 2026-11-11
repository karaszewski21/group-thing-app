import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { renderWithRoute } from "./renderWithRoute";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationLayoutResponse, PageLayoutKey, PublicOrganizationResponse } from "../api/organizations";
import type { OwnerItemCard, OwnerNearestDate } from "../api/ownerItems";
import { LayoutRenderer } from "../features/organization-public/LayoutRenderer";
import { FALLBACK_LAYOUT, LAYOUT_REGISTRY, resolveLayout } from "../features/organization-public/layouts/registry";
import type { BlockSlot, OrganizerPageData, RenderMode } from "../features/organization-public/layouts/types";
import dayjs from "../utils/dayjs";
import {
  classicLayout,
  exchangeLayout,
  layoutDate,
  layoutGroup,
  layoutItem,
  layoutStats,
  linksLayout,
  meetingLink,
  scheduleLayout,
} from "./organizationLayoutFixtures";
import { createQueryWrapper } from "./queryClient";

const SLUG = "rodzinny-grajdolek";

const organization: PublicOrganizationResponse = {
  slug: SLUG,
  name: "Rodzinny Grajdołek",
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

const EMPTY: Record<PageLayoutKey, OrganizationLayoutResponse> = {
  CLASSIC: classicLayout(),
  LINKS: linksLayout(),
  SCHEDULE: scheduleLayout(),
  EXCHANGE: exchangeLayout(),
};

function pageData(directory: OrganizationLayoutResponse): OrganizerPageData {
  return { organization, directoryStatus: "ready", directory };
}

const loading: OrganizerPageData = { organization, directory: null, directoryStatus: "loading" };
const unavailable: OrganizerPageData = { organization, directory: null, directoryStatus: "unavailable" };

function meeting(id: string, startsAt: string, overrides: Partial<OwnerNearestDate> = {}): OwnerNearestDate {
  return layoutDate(id, startsAt, {
    name: "Orliki 2017",
    attendee_count: 8,
    path: `/${SLUG}/group/g1/term/${id}`,
    ...overrides,
  });
}

function recentItem(id: string, name: string, mode: OwnerItemCard["mode"]): OwnerItemCard {
  return layoutItem(id, { product_name: name, mode, added_at: "2026-10-30T09:00:00" });
}

const RECENT = [recentItem("i1", "Kurtka", "GIFT"), recentItem("i2", "Rower", "SWAP")];

const NEAREST_EVENT = meeting("e1", "2026-11-07T10:00:00", {
  kind: "EVENT",
  name: "Wymianka sąsiedzka",
  attendee_count: 14,
  path: `/${SLUG}/event/e1`,
});

function group(id: string, name: string) {
  return layoutGroup(id, {
    name,
    next_term: { id: `next-${id}`, occurs_on: "2026-10-14T17:00:00", attendee_count: 5 },
    upcoming_term_count: 2,
  });
}

function inDays(days: number): string {
  return dayjs().add(days, "day").format("YYYY-MM-DDTHH:mm:ss");
}

function renderLayout(key: PageLayoutKey, pageState: OrganizerPageData = pageData(EMPTY[key]), mode: RenderMode = "visitor") {
  return renderWithRoute(<LayoutRenderer layout={resolveLayout(key)} data={pageState} mode={mode} />, {
    url: "/",
    wrapper: createQueryWrapper(),
  });
}

function slotMatches(slot: BlockSlot, groups: number): boolean {
  const { minGroups, maxGroups } = slot.when ?? {};
  return (minGroups === undefined || groups >= minGroups) && (maxGroups === undefined || groups <= maxGroups);
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LayoutRenderer", () => {
  it("renders CLASSIC for a visitor with hero and share but no ghost", () => {
    renderLayout("CLASSIC");

    expect(screen.getByRole("heading", { level: 1, name: "Rodzinny Grajdołek" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Udostępnij" })).toBeInTheDocument();
    expect(screen.queryByText("Napisz kilka zdań o sobie i swoich zajęciach — odwiedzający zobaczą je tutaj. Widzisz to tylko Ty.")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "O nas" })).not.toBeInTheDocument();
  });

  it("renders the about ghost for the owner, whose only focusable part opens the Opis tab", () => {
    renderLayout("CLASSIC", undefined, "owner-edit");

    const ghost = screen.getByText("Napisz kilka zdań o sobie i swoich zajęciach — odwiedzający zobaczą je tutaj. Widzisz to tylko Ty.").closest("[data-ghost]") as HTMLElement;
    expect(ghost).toHaveAttribute("data-ghost", "about");
    expect(ghost).not.toHaveAttribute("tabindex");
    expect(ghost).not.toHaveAttribute("role");
    expect(within(ghost).getByRole("link", { name: "Dodaj opis →" })).toHaveAttribute("href", `/${SLUG}/appearance?tab=photos`);
    expect(ghost.querySelectorAll("button, a, [tabindex]")).toHaveLength(1);
  });

  it("shows the description with its line breaks to visitors and the owner instead of the ghost", () => {
    const described = { ...pageData(EMPTY.CLASSIC), organization: { ...organization, description: "Śpiewamy.\nTańczymy." } };
    for (const mode of ["visitor", "owner-edit"] as const) {
      const { container } = renderLayout("CLASSIC", described, mode);
      const about = screen.getByRole("region", { name: "O nas" });
      expect(about).toHaveTextContent("Śpiewamy. Tańczymy.");
      expect(within(about).getByText(/Śpiewamy/)).toHaveClass("whitespace-pre-line");
      expect(container.querySelector('[data-ghost="about"]')).toBeNull();
      cleanup();
    }
  });

  it("renders LINKS with the full-width share button in the primary-colored centered frame", () => {
    const { container } = renderLayout("LINKS");

    expect(screen.getByRole("button", { name: "Udostępnij stronę" })).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute("data-frame", "centered");
    expect(container.firstElementChild).toHaveClass("flex-1", "bg-primary", "text-on-primary");
  });

  it("falls back to CLASSIC for unknown or missing keys", () => {
    expect(resolveLayout("custom:x").key).toBe("CLASSIC");
    expect(resolveLayout(undefined).key).toBe("CLASSIC");
    expect(resolveLayout(null).key).toBe(FALLBACK_LAYOUT);
    expect(resolveLayout("LINKS").key).toBe("LINKS");
    expect(resolveLayout("SCHEDULE").key).toBe("SCHEDULE");
  });

  it("registers four layouts with their labels, thumbnail alts and compositions", () => {
    const layouts = Object.entries(LAYOUT_REGISTRY);
    expect(layouts.map(([key]) => key)).toEqual(["CLASSIC", "LINKS", "SCHEDULE", "EXCHANGE"]);
    for (const [key, layout] of layouts) {
      expect(layout.key).toBe(key);
      expect(layout.thumbnail.alt).toBe(`Szkic układu ${layout.label}`);
    }
    expect(layouts.map(([, layout]) => layout.label)).toEqual(["Klasyczny", "Wizytówka", "Spotkania", "Rzeczy"]);

    const composition = (key: PageLayoutKey) =>
      LAYOUT_REGISTRY[key].blocks.map(
        (slot) => `${slot.block}${slot.variant ? `:${slot.variant}` : ""}${slot.primary ? "*" : ""}`,
      );
    expect(composition("CLASSIC")).toEqual([
      "hero:cover",
      "share",
      "stats",
      "about",
      "gallery:grid",
      "upcoming-dates:list*",
      "recent-items",
      "footer",
    ]);
    expect(composition("LINKS")).toEqual([
      "hero:centered",
      "link-stack*",
      "about:on-primary",
      "gallery:on-primary",
      "footer:on-primary",
    ]);
    expect(composition("SCHEDULE")).toEqual([
      "hero:compact",
      "stats",
      "next-date-cta:card*",
      "upcoming-dates:after-next",
      "groups-grid:cards",
      "groups-grid:featured",
      "item-stats",
      "about",
      "gallery:grid",
      "footer",
    ]);
    expect(composition("EXCHANGE")).toEqual([
      "hero:compact",
      "stats",
      "recent-items:featured*",
      "meeting-links",
      "about",
      "gallery:grid",
      "footer",
    ]);
  });

  it("keeps exactly one active primary slot for 0, 1 and 2 groups, with SCHEDULE groups featured at 1 and cards at 2", () => {
    for (const groups of [0, 1, 2]) {
      for (const layout of Object.values(LAYOUT_REGISTRY)) {
        const primaries = layout.blocks.filter((slot) => slot.primary && slotMatches(slot, groups));
        expect(primaries, `${layout.key} with ${groups} groups`).toHaveLength(1);
      }
    }

    renderLayout("SCHEDULE", pageData(scheduleLayout({ groups: [group("g1", "Orliki 2017")] })));
    expect(screen.getByRole("heading", { name: "Nasza grupa" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Nasze grupy" })).not.toBeInTheDocument();
    cleanup();

    renderLayout(
      "SCHEDULE",
      pageData(scheduleLayout({ groups: [group("g1", "Orliki 2017"), group("g2", "Młodziki 2015")] })),
    );
    expect(screen.getByRole("heading", { name: "Nasze grupy" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Nasza grupa" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Wszystkie terminy grupy Młodziki 2015" })).toHaveAttribute(
      "href",
      `/${SLUG}/group/g2/terms`,
    );
  });

  it("renders one skeleton per directory block id while the layout data loads", () => {
    const { container } = renderLayout("SCHEDULE", loading);

    // stats, next-date-cta, upcoming-dates, groups-grid (one for both `when` variants) and item-stats.
    expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(5);
    expect(screen.getByRole("heading", { level: 1, name: "Rodzinny Grajdołek" })).toBeInTheDocument();
  });

  it("hides directory slots from visitors and shows neutral ghosts to the owner when unavailable", () => {
    const { container } = renderLayout("SCHEDULE", unavailable);

    expect(screen.getByText("Brak informacji do pokazania")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Udostępnij stronę" })).toBeInTheDocument();
    expect(screen.queryByText("NAJBLIŻSZE ZAJĘCIA")).not.toBeInTheDocument();
    expect(container.querySelector("[data-ghost], [aria-busy]")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Rodzinny Grajdołek" })).toBeInTheDocument();
    cleanup();

    const owner = renderLayout("SCHEDULE", unavailable, "owner-edit");
    const ghosts = Array.from(owner.container.querySelectorAll("[data-ghost]"), (ghost) =>
      ghost.getAttribute("data-ghost"),
    );
    expect(ghosts).toEqual(["stats", "next-date-cta", "upcoming-dates", "groups-grid", "item-stats", "about", "gallery"]);
    expect(
      screen.getAllByText("Nie udało się wczytać danych. Odwiedzający nie widzą tej sekcji."),
    ).toHaveLength(5);
    // Only the about and gallery ghosts, which do not depend on the layout data, keep their CTAs.
    expect(screen.getAllByRole("link", { name: /Dodaj/ }).map((link) => link.textContent)).toEqual(["Dodaj opis →", "Dodaj zdjęcia →"]);
    expect(screen.queryByText("Brak informacji do pokazania")).not.toBeInTheDocument();
  });

  it("gives an empty primary the layout's empty state for visitors and the CTA ghost for the owner", () => {
    const cases = [
      { key: "CLASSIC", title: "Brak zaplanowanych spotkań", block: "upcoming-dates", cta: "Dodaj wydarzenie →" },
      { key: "SCHEDULE", title: "Brak zaplanowanych spotkań", block: "next-date-cta", cta: "Dodaj termin →" },
      { key: "EXCHANGE", title: "Na razie nic tu nie ma", block: "recent-items", cta: "Dodaj rzecz do wymiany →" },
    ] as const;
    for (const { key, title, block, cta } of cases) {
      renderLayout(key);
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Udostępnij stronę" })).toBeInTheDocument();
      cleanup();

      const owner = renderLayout(key, undefined, "owner-edit");
      const ghost = owner.container.querySelector(`[data-ghost="${block}"]`) as HTMLElement;
      expect(ghost, key).not.toBeNull();
      expect(within(ghost).getByRole("link", { name: cta })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: title })).not.toBeInTheDocument();
      cleanup();
    }
  });

  it("renders the LINKS buttons from the stats per state and the SCHEDULE compact hero", () => {
    const stats = layoutStats({ group_count: 2, item_count: 8, meeting_count: 5 });

    const { container } = renderLayout("LINKS", pageData(linksLayout({ stats })));
    const actions = Array.from(container.querySelectorAll("a, button"));
    expect(actions.map((action) => action.textContent)).toEqual([
      "Spotkania· 5 nadchodzących",
      "Rzeczy· 8 dostępnych",
      "Udostępnij stronę",
    ]);
    expect(actions[0]).toHaveAttribute("href", `/${SLUG}/meetings`);
    expect(actions[0]).toHaveClass("bg-paper");
    expect(actions[1]).toHaveAttribute("href", `/${SLUG}/items`);
    expect(actions[2]).not.toHaveClass("bg-paper");
    expect(container.querySelector(`a[href^="/${SLUG}/terms"]`)).toBeNull();
    cleanup();

    const itemsOnly = renderLayout("LINKS", pageData(linksLayout({ stats: layoutStats({ item_count: 1 }) })));
    const itemActions = Array.from(itemsOnly.container.querySelectorAll("a"));
    expect(itemActions.map((action) => action.textContent)).toEqual(["Rzeczy· 1 dostępna"]);
    expect(itemActions[0]).toHaveClass("bg-paper");
    cleanup();

    const whileLoading = renderLayout("LINKS", loading);
    expect(whileLoading.container.querySelectorAll(".animate-pulse")).toHaveLength(2);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Udostępnij stronę" })).toBeInTheDocument();
    cleanup();

    renderLayout("LINKS", unavailable);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Udostępnij stronę" })).toHaveClass("bg-paper");
    cleanup();

    renderLayout("SCHEDULE", pageData(scheduleLayout({ stats, upcoming_terms: [meeting("t1", "2026-10-14T17:00:00")] })));
    const hero = screen.getByRole("heading", { level: 1, name: "Rodzinny Grajdołek" }).closest("header")!;
    expect(hero).toHaveClass("bg-paper", "border-b", "border-line");
    expect(within(hero).getByRole("button", { name: "Udostępnij" })).toHaveClass("min-h-[44px]");
  });

  it("shows the SCHEDULE item stats as two linked mode tiles", () => {
    renderLayout("SCHEDULE", pageData(scheduleLayout({ item_stats: { GIFT: 3, SWAP: 1 } })));

    expect(screen.getByRole("heading", { name: "Wymiana rzeczy" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "3 Chcę oddać" })).toHaveAttribute("href", `/${SLUG}/items`);
    expect(screen.getByRole("link", { name: "1 Chcę się zamienić" })).toHaveAttribute("href", `/${SLUG}/items`);
  });

  it("shows CLASSIC's latest items under their own heading and EXCHANGE's as the featured offer", () => {
    renderLayout("CLASSIC", pageData(classicLayout({ items: RECENT })));
    expect(screen.getByRole("heading", { name: "Ostatnio dodane rzeczy" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Rzeczy do oddania i wymiany" })).not.toBeInTheDocument();
    cleanup();

    renderLayout("EXCHANGE", pageData(exchangeLayout({ items: RECENT })));
    const block = screen.getByRole("region", { name: "Rzeczy do oddania i wymiany" });
    expect(within(block).getAllByRole("listitem")).toHaveLength(2);
    expect(within(block).getByRole("link", { name: "Kurtka" })).toHaveAttribute("href", `/${SLUG}/product/i1`);
    expect(within(block).getByText("Chcę oddać")).toHaveClass("bg-primary-soft");
    expect(within(block).getByText("Chcę się zamienić")).toHaveClass("bg-accent-soft");
    expect(within(block).getByRole("link", { name: "Zobacz wszystkie rzeczy →" })).toHaveAttribute(
      "href",
      `/${SLUG}/items`,
    );
  });

  it("shows EXCHANGE's nearest meetings as date-only links", () => {
    const links = [
      meetingLink(`/${SLUG}/group/g1/term/t1`, "2026-10-14T17:00:00"),
      meetingLink(`/${SLUG}/event/e1`, NEAREST_EVENT.starts_at, "EVENT"),
    ];
    renderLayout("EXCHANGE", pageData(exchangeLayout({ items: RECENT, term_links: links })));

    expect(screen.getByRole("heading", { name: "Najbliższe spotkania" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zajęcia Śr 14 paź, 17:00" })).toHaveAttribute(
      "href",
      `/${SLUG}/group/g1/term/t1`,
    );
    expect(screen.getByRole("link", { name: "Wydarzenie So 7 lis, 10:00" })).toHaveAttribute("href", `/${SLUG}/event/e1`);
    expect(screen.getByRole("link", { name: "Wszystkie spotkania →" })).toHaveAttribute("href", `/${SLUG}/meetings`);
  });

  it("shows visitors the empty state for missing items and the owner a ghost", () => {
    renderLayout("EXCHANGE");
    expect(screen.getByRole("heading", { name: "Na razie nic tu nie ma" })).toBeInTheDocument();
    cleanup();

    const owner = renderLayout("EXCHANGE", undefined, "owner-edit");
    const ghost = owner.container.querySelector('[data-ghost="recent-items"]') as HTMLElement;
    expect(ghost).not.toBeNull();
    expect(within(ghost).getByText("Ostatnio dodane rzeczy")).toBeInTheDocument();
    expect(within(ghost).getByRole("link", { name: "Dodaj rzecz do wymiany →" })).toHaveAttribute("href", "/items");
  });

  it("never renders identity fields smuggled into the layout data on a full CLASSIC page", () => {
    const identity = { lister_party_id: "party-secret-1", lister_display_name: "Kasia Wójcik", avatar_url: "avatar.png" };
    const full = classicLayout({
      stats: layoutStats({ group_count: 2, meeting_count: 1, item_count: 1 }),
      upcoming_terms: [{ ...meeting("t1", inDays(2)), ...identity } as OwnerNearestDate],
      items: [{ ...recentItem("i1", "Kask", "GIFT"), ...identity } as OwnerItemCard],
    });

    const { container } = renderLayout("CLASSIC", pageData(full));

    expect(screen.getByText("Orliki 2017")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Kask" })).toHaveAttribute("href", `/${SLUG}/product/i1`);
    expect(container.textContent).not.toMatch(/Kasia|Wójcik|party-secret/);
    expect(container.innerHTML).not.toMatch(/party-secret|avatar\.png/);
  });

  it("copies origin/slug without the query string when navigator.share is missing", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    window.history.pushState({}, "", "/rodzinny-grajdolek?tab=1");

    renderLayout("CLASSIC", undefined, "owner-edit");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Udostępnij" }));
    });

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/rodzinny-grajdolek`);
    expect(screen.getByRole("status")).toHaveTextContent("Skopiowano link");
    window.history.pushState({}, "", "/");
  });
});
