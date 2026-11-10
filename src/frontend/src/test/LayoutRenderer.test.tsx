import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { renderWithRoute } from "./renderWithRoute";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizerCircle, OrganizerPageResponse, OrganizerTerm } from "../api/groups";
import type { OwnerItemCard, OwnerNearestDate } from "../api/ownerItems";
import type { PublicOrganizationResponse } from "../api/organizations";
import { LayoutRenderer } from "../features/organization-public/LayoutRenderer";
import { FALLBACK_LAYOUT, isRecommended, LAYOUT_REGISTRY, resolveLayout } from "../features/organization-public/layouts/registry";
import type { BlockSlot, OrganizerPageData, RenderMode } from "../features/organization-public/layouts/types";
import dayjs from "../utils/dayjs";
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

function pageData(overrides: Partial<OrganizerPageResponse> = {}): OrganizerPageData {
  return {
    organization,
    directoryStatus: "ready",
    directory: {
      circles: [],
      upcoming_terms: [],
      exchange: { counts: { GIFT: 0, SWAP: 0, RESERVED: 0 }, items: [] },
      needed_items: [],
      stats: { circle_count: 0, upcoming_term_count: 0, family_count: null },
      upcoming_dates: [],
      recent_items: [],
      owner_nearest: null,
      ...overrides,
    },
  };
}

const data = pageData();
const loading: OrganizerPageData = { organization, directory: null, directoryStatus: "loading" };
const unavailable: OrganizerPageData = { organization, directory: null, directoryStatus: "unavailable" };

function circle(id: string, name: string): OrganizerCircle {
  return {
    id,
    name,
    layout_mode: "CIRCLE",
    next_term: { id: `next-${id}`, occurs_on: "2026-10-14T17:00:00", attendee_count: 5 },
    upcoming_term_count: 2,
  };
}

function term(id: string, occursOn: string): OrganizerTerm {
  return {
    term_id: id,
    group_id: "g1",
    group_name: "Orliki 2017",
    occurs_on: occursOn,
    description: null,
    attendee_count: 8,
  };
}

function meeting(id: string, startsAt: string, overrides: Partial<OwnerNearestDate> = {}): OwnerNearestDate {
  return {
    kind: "TERM",
    id,
    name: "Orliki 2017",
    starts_at: startsAt,
    location_name: null,
    attendee_count: 8,
    path: `/${SLUG}/group/g1/term/${id}`,
    ...overrides,
  };
}

function recentItem(id: string, name: string, mode: OwnerItemCard["mode"]): OwnerItemCard {
  return { item_id: id, product_name: name, condition: "GOOD", mode, thumb_url: null, added_at: "2026-10-30T09:00:00", reservation: null };
}

const RECENT = [recentItem("i1", "Kurtka", "GIFT"), recentItem("i2", "Rower", "SWAP")];

const NEAREST_EVENT: OwnerNearestDate = {
  kind: "EVENT",
  id: "e1",
  name: "Wymianka sąsiedzka",
  starts_at: "2026-11-07T10:00:00",
  location_name: null,
  attendee_count: 14,
  path: `/${SLUG}/event/e1`,
};

function inDays(days: number): string {
  return dayjs().add(days, "day").format("YYYY-MM-DDTHH:mm:ss");
}

function renderLayout(key: string, pageState: OrganizerPageData, mode: RenderMode = "visitor") {
  return renderWithRoute(
    <LayoutRenderer layout={resolveLayout(key)} data={pageState} mode={mode} />,
    { url: "/", wrapper: createQueryWrapper() },
  );
}

function slotMatches(slot: BlockSlot, circles: number): boolean {
  const { minCircles, maxCircles } = slot.when ?? {};
  return (minCircles === undefined || circles >= minCircles) && (maxCircles === undefined || circles <= maxCircles);
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LayoutRenderer", () => {
  it("renders CLASSIC for a visitor with hero, share and footer but no ghost", () => {
    renderLayout("CLASSIC", data);

    expect(screen.getByRole("heading", { level: 1, name: "Rodzinny Grajdołek" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Udostępnij" })).toBeInTheDocument();
    expect(screen.getByText("Strona utworzona w Krąg grupy")).toBeInTheDocument();
    expect(screen.queryByText("Napisz kilka zdań o sobie i swoich zajęciach — odwiedzający zobaczą je tutaj. Widzisz to tylko Ty.")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "O nas" })).not.toBeInTheDocument();
  });

  it("renders the about ghost for the owner, whose only focusable part opens the Opis tab", () => {
    renderLayout("CLASSIC", data, "owner-edit");

    const ghost = screen.getByText("Napisz kilka zdań o sobie i swoich zajęciach — odwiedzający zobaczą je tutaj. Widzisz to tylko Ty.").closest("[data-ghost]") as HTMLElement;
    expect(ghost).toHaveAttribute("data-ghost", "about");
    expect(ghost).not.toHaveAttribute("tabindex");
    expect(ghost).not.toHaveAttribute("role");
    expect(within(ghost).getByRole("link", { name: "Dodaj opis →" })).toHaveAttribute("href", `/${SLUG}/appearance?tab=photos`);
    expect(ghost.querySelectorAll("button, a, [tabindex]")).toHaveLength(1);
  });

  it("shows the description with its line breaks to visitors and the owner instead of the ghost", () => {
    const described = { ...data, organization: { ...organization, description: "Śpiewamy.\nTańczymy." } };
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
    const { container } = renderLayout("LINKS", data);

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

    const composition = (key: string) =>
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
      "exchange-counts:tiles3",
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
      "next-date-cta:card*",
      "upcoming-dates:after-next",
      "circles-grid:cards",
      "circles-grid:featured",
      "about",
      "gallery:grid",
      "exchange-counts:tiles3",
      "footer",
    ]);
    expect(composition("EXCHANGE")).toEqual([
      "hero:compact",
      "recent-items:featured*",
      "exchange-board:grid2",
      "needed-items:list",
      "upcoming-dates:compact",
      "about",
      "gallery:grid",
      "footer",
    ]);
  });

  it("keeps exactly one active primary slot for 0, 1 and 2 circles, with SCHEDULE groups featured at 1 and cards at 2", () => {
    for (const circles of [0, 1, 2]) {
      for (const layout of Object.values(LAYOUT_REGISTRY)) {
        const primaries = layout.blocks.filter((slot) => slot.primary && slotMatches(slot, circles));
        expect(primaries, `${layout.key} with ${circles} circles`).toHaveLength(1);
      }
    }

    renderLayout("SCHEDULE", pageData({ circles: [circle("g1", "Orliki 2017")] }));
    expect(screen.getByRole("heading", { name: "Nasza grupa" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Nasze grupy" })).not.toBeInTheDocument();
    cleanup();

    renderLayout("SCHEDULE", pageData({ circles: [circle("g1", "Orliki 2017"), circle("g2", "Młodziki 2015")] }));
    expect(screen.getByRole("heading", { name: "Nasze grupy" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Nasza grupa" })).not.toBeInTheDocument();
  });

  it("renders one skeleton per directory block id while the directory loads", () => {
    const { container } = renderLayout("SCHEDULE", loading);

    // next-date-cta, upcoming-dates, circles-grid (one for both `when` variants) and exchange-counts.
    expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(4);
    expect(screen.getByRole("heading", { level: 1, name: "Rodzinny Grajdołek" })).toBeInTheDocument();
    expect(screen.getByText("Strona utworzona w Krąg grupy")).toBeInTheDocument();
  });

  it("hides directory slots from visitors and shows neutral ghosts to the owner when unavailable", () => {
    const { container } = renderLayout("SCHEDULE", unavailable);

    expect(screen.getByText("Brak informacji do pokazania")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Udostępnij stronę" })).toBeInTheDocument();
    expect(screen.queryByText("NAJBLIŻSZE ZAJĘCIA")).not.toBeInTheDocument();
    expect(container.querySelector("[data-ghost], [aria-busy]")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Rodzinny Grajdołek" })).toBeInTheDocument();
    expect(screen.getByText("Strona utworzona w Krąg grupy")).toBeInTheDocument();
    cleanup();

    const owner = renderLayout("SCHEDULE", unavailable, "owner-edit");
    const ghosts = Array.from(owner.container.querySelectorAll("[data-ghost]"), (ghost) =>
      ghost.getAttribute("data-ghost"),
    );
    expect(ghosts).toEqual(["next-date-cta", "upcoming-dates", "circles-grid", "about", "gallery", "exchange-counts"]);
    expect(
      screen.getAllByText("Nie udało się wczytać danych. Odwiedzający nie widzą tej sekcji."),
    ).toHaveLength(4);
    // Only the about and gallery ghosts, which do not depend on the directory, keep their CTAs.
    expect(screen.getAllByRole("link", { name: /Dodaj/ }).map((link) => link.textContent)).toEqual(["Dodaj opis →", "Dodaj zdjęcia →"]);
    expect(screen.queryByText("Brak informacji do pokazania")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Rodzinny Grajdołek" })).toBeInTheDocument();
  });

  it("gives an empty primary the layout's empty state for visitors and the CTA ghost for the owner", () => {
    const cases = [
      { key: "CLASSIC", title: "Brak zaplanowanych spotkań", block: "upcoming-dates", cta: "Dodaj wydarzenie →" },
      { key: "SCHEDULE", title: "Brak zaplanowanych spotkań", block: "next-date-cta", cta: "Dodaj termin →" },
      { key: "EXCHANGE", title: "Na razie nic tu nie ma", block: "recent-items", cta: "Dodaj rzecz do wymiany →" },
    ];
    for (const { key, title, block, cta } of cases) {
      renderLayout(key, data);
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Udostępnij stronę" })).toBeInTheDocument();
      cleanup();

      const owner = renderLayout(key, data, "owner-edit");
      const ghost = owner.container.querySelector(`[data-ghost="${block}"]`) as HTMLElement;
      expect(ghost, key).not.toBeNull();
      expect(within(ghost).getByRole("link", { name: cta })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: title })).not.toBeInTheDocument();
      cleanup();
    }
  });

  it("recommends layouts from the directory data", () => {
    const recommended = (pageState: OrganizerPageData) =>
      Object.values(LAYOUT_REGISTRY)
        .filter((layout) => isRecommended(layout, pageState))
        .map((layout) => layout.key);
    const soon = [1, 3, 6].map((days, index) => meeting(`t${index}`, inDays(days)));
    const items = ["i1", "i2", "i3", "i4"].map((id) => recentItem(id, `Rzecz ${id}`, "GIFT"));

    expect(recommended(data)).toEqual(["LINKS"]);
    expect(recommended(unavailable)).toEqual(["LINKS"]);
    expect(recommended(loading)).toEqual([]);
    expect(recommended(pageData({ upcoming_dates: soon }))).toEqual(["SCHEDULE"]);
    expect(recommended(pageData({ recent_items: items, upcoming_dates: soon.slice(0, 1) }))).toEqual(["EXCHANGE"]);
    expect(
      recommended(pageData({ upcoming_dates: [...soon.slice(0, 2), meeting("late", inDays(20))], recent_items: RECENT })),
    ).toEqual([]);
  });

  it("renders the LINKS directory buttons per state and the SCHEDULE compact hero", () => {
    const nearest = meeting("t1", "2026-10-14T17:00:00");
    const ready = pageData({
      circles: [circle("g1", "Orliki 2017")],
      upcoming_terms: [term("t1", "2026-10-14T17:00:00")],
      upcoming_dates: [nearest, NEAREST_EVENT],
      exchange: {
        counts: { GIFT: 4, SWAP: 4, RESERVED: 0 },
        items: [
          {
            item_id: "i1",
            product_name: "Kask",
            condition: "GOOD",
            mode: "SWAP",
            thumb_url: null,
            term_id: "t9",
            group_id: "g2",
            occurs_on: "2026-10-18T10:00:00",
            reservation: null,
          },
        ],
      },
      stats: { circle_count: 1, upcoming_term_count: 9, family_count: null },
    });

    const { container } = renderLayout("LINKS", ready);
    const actions = Array.from(container.querySelectorAll("a, button"));
    expect(actions.map((action) => action.textContent)).toEqual([
      `Najbliższe zajęcia · ${dayjs(nearest.starts_at).format("dd D.MM HH:mm")}`,
      "Wszystkie spotkania",
      "Wymiana rzeczy (8)",
      "Udostępnij stronę",
    ]);
    expect(actions[0]).toHaveAttribute("href", `/${SLUG}/group/g1/term/t1`);
    expect(actions[0]).toHaveClass("bg-paper");
    expect(actions[1]).toHaveAttribute("href", `/${SLUG}/meetings`);
    expect(actions[2]).toHaveAttribute("href", `/${SLUG}/group/g2/term/t9`);
    expect(actions[3]).not.toHaveClass("bg-paper");
    cleanup();

    const withItems = renderLayout("LINKS", pageData({ upcoming_dates: [NEAREST_EVENT], recent_items: RECENT }));
    const itemActions = Array.from(withItems.container.querySelectorAll("a"));
    expect(itemActions.map((action) => action.textContent)).toEqual([
      `Najbliższe wydarzenie · ${dayjs(NEAREST_EVENT.starts_at).format("dd D.MM HH:mm")}`,
      "Wszystkie spotkania",
      "Rzeczy do oddania i wymiany",
    ]);
    expect(itemActions[0]).toHaveAttribute("href", `/${SLUG}/event/e1`);
    expect(itemActions[2]).toHaveAttribute("href", `/${SLUG}/items`);
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

    renderLayout("SCHEDULE", ready);
    const hero = screen.getByRole("heading", { level: 1, name: "Rodzinny Grajdołek" }).closest("header")!;
    expect(hero).toHaveClass("bg-paper", "border-b", "border-line");
    expect(within(hero).getByText(`domena.pl/${SLUG}`)).toBeInTheDocument();
    expect(within(hero).getByRole("button", { name: "Udostępnij" })).toHaveClass("min-h-[44px]");
  });

  it("features recent items first in EXCHANGE only", () => {
    for (const layout of Object.values(LAYOUT_REGISTRY)) {
      const blocks = layout.blocks.map((slot) => slot.block);
      if (layout.key !== "EXCHANGE") {
        expect(blocks, layout.key).not.toContain("recent-items");
        continue;
      }
      expect(blocks.slice(0, 3)).toEqual(["hero", "recent-items", "exchange-board"]);
    }

    renderLayout("CLASSIC", pageData({ recent_items: RECENT }));
    expect(screen.queryByRole("heading", { name: "Rzeczy do oddania i wymiany" })).not.toBeInTheDocument();
  });

  it("shows recent item tiles with intent pills linking to the plain product page, even with a nearest date", () => {
    renderLayout("EXCHANGE", pageData({ recent_items: RECENT, owner_nearest: NEAREST_EVENT }));

    const block = screen.getByRole("region", { name: "Rzeczy do oddania i wymiany" });
    expect(within(block).getAllByRole("listitem")).toHaveLength(2);
    expect(within(block).getByRole("link", { name: "Kurtka" })).toHaveAttribute("href", `/${SLUG}/product/i1`);
    expect(within(block).getByText("Chcę oddać")).toHaveClass("bg-primary-soft");
    expect(within(block).getByText("Chcę się zamienić")).toHaveClass("bg-accent-soft");
    expect(block).not.toHaveTextContent(dayjs(NEAREST_EVENT.starts_at).format("ddd D MMM"));
    expect(within(block).getByRole("link", { name: "Zobacz wszystkie rzeczy →" })).toHaveAttribute(
      "href",
      `/${SLUG}/items`,
    );
  });

  it("shows visitors the empty state for missing items and the owner a ghost", () => {
    renderLayout("EXCHANGE", data);
    expect(screen.getByRole("heading", { name: "Na razie nic tu nie ma" })).toBeInTheDocument();
    cleanup();

    const owner = renderLayout("EXCHANGE", data, "owner-edit");
    const ghost = owner.container.querySelector('[data-ghost="recent-items"]') as HTMLElement;
    expect(ghost).not.toBeNull();
    expect(within(ghost).getByText("Ostatnio dodane rzeczy")).toBeInTheDocument();
    expect(within(ghost).getByRole("link", { name: "Dodaj rzecz do wymiany →" })).toHaveAttribute("href", "/items");
  });

  it("recommends nothing while loading, even with a directory that would recommend SCHEDULE", () => {
    const busy = pageData({ upcoming_dates: [1, 2, 3, 4].map((days, index) => meeting(`t${index}`, inDays(days))) });
    const stillLoading: OrganizerPageData = { ...busy, directoryStatus: "loading" };

    expect(isRecommended(LAYOUT_REGISTRY.SCHEDULE, busy)).toBe(true);
    expect(Object.values(LAYOUT_REGISTRY).filter((layout) => isRecommended(layout, stillLoading))).toEqual([]);
  });

  it("never renders identity fields smuggled into the directory on a full CLASSIC page", () => {
    const identity = { lister_party_id: "party-secret-1", lister_display_name: "Kasia Wójcik", avatar_url: "avatar.png" };
    const full = pageData({
      circles: [circle("g1", "Orliki 2017"), circle("g2", "Młodziki 2015")],
      upcoming_terms: [{ ...term("t1", inDays(2)), ...identity } as OrganizerTerm],
      upcoming_dates: [{ ...meeting("t1", inDays(2)), ...identity } as OwnerNearestDate],
      exchange: {
        counts: { GIFT: 1, SWAP: 0, RESERVED: 0 },
        items: [
          {
            item_id: "i1",
            product_name: "Kask",
            condition: "GOOD",
            mode: "GIFT",
            thumb_url: null,
            term_id: "t1",
            group_id: "g1",
            occurs_on: inDays(2),
            reservation: null,
            ...identity,
          },
        ],
      },
      stats: { circle_count: 2, upcoming_term_count: 1, family_count: 4 },
    });

    const { container } = renderLayout("CLASSIC", full);

    expect(screen.getByText("Orliki 2017")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /1\s*Chcę oddać/ })).toHaveAttribute("href", `/${SLUG}/group/g1/term/t1`);
    expect(container.textContent).not.toMatch(/Kasia|Wójcik|party-secret/);
    expect(container.innerHTML).not.toMatch(/party-secret|avatar\.png/);
  });

  it("copies origin/slug without the query string when navigator.share is missing", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    window.history.pushState({}, "", "/rodzinny-grajdolek?tab=1");

    renderLayout("CLASSIC", data, "owner-edit");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Udostępnij" }));
    });

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/rodzinny-grajdolek`);
    expect(screen.getByRole("status")).toHaveTextContent("Skopiowano link");
    window.history.pushState({}, "", "/");
  });
});
