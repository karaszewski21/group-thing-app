import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as groupsApi from "../api/groups";
import type { OrganizerCircle, OrganizerPageResponse, OrganizerTerm } from "../api/groups";
import type { PublicOrganizationResponse } from "../api/organizations";
import { LayoutRenderer } from "../pages/organizer/LayoutRenderer";
import { FALLBACK_LAYOUT, isRecommended, LAYOUT_REGISTRY, resolveLayout } from "../pages/organizer/layouts/registry";
import type { BlockSlot, OrganizerPageData, RenderMode } from "../pages/organizer/layouts/types";
import dayjs from "../utils/dayjs";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/groups", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/groups")>()),
  getOrganizerTerms: vi.fn(),
}));

const SLUG = "rodzinny-grajdolek";

const organization: PublicOrganizationResponse = {
  slug: SLUG,
  name: "Rodzinny Grajdołek",
  primary_color: null,
  accent_color: null,
  page_layout: "CLASSIC",
  palette_preset: null,
};

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

function inDays(days: number): string {
  return dayjs().add(days, "day").format("YYYY-MM-DDTHH:mm:ss");
}

function renderLayout(key: string, pageState: OrganizerPageData, mode: RenderMode = "visitor") {
  return render(
    <MemoryRouter>
      <LayoutRenderer layout={resolveLayout(key)} data={pageState} mode={mode} />
    </MemoryRouter>,
    { wrapper: createQueryWrapper() },
  );
}

function slotMatches(slot: BlockSlot, circles: number): boolean {
  const { minCircles, maxCircles } = slot.when ?? {};
  return (minCircles === undefined || circles >= minCircles) && (maxCircles === undefined || circles <= maxCircles);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(groupsApi.getOrganizerTerms).mockReturnValue(new Promise(() => {}));
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
    expect(screen.getByText("Strona utworzona w domena.pl")).toBeInTheDocument();
    expect(screen.queryByText("Opis — wkrótce")).not.toBeInTheDocument();
  });

  it("renders a non-interactive ghost for the owner", () => {
    renderLayout("CLASSIC", data, "owner-edit");

    const title = screen.getByText("Opis — wkrótce");
    expect(screen.getByText("Tu pojawi się opis Twojej organizacji. Widzisz to tylko Ty.")).toBeInTheDocument();
    const ghost = title.closest("[data-ghost]");
    expect(ghost).not.toBeNull();
    expect(ghost).not.toHaveAttribute("tabindex");
    expect(ghost).not.toHaveAttribute("role");
    expect(ghost!.querySelector("button, a, [tabindex]")).toBeNull();
  });

  it("renders LINKS with the full-width share button in the centered frame", () => {
    const { container } = renderLayout("LINKS", data);

    expect(screen.getByRole("button", { name: "Udostępnij stronę" })).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute("data-frame", "centered");
    expect(container.firstElementChild).toHaveClass("flex-1", "justify-center");
  });

  it("falls back to CLASSIC for unknown or missing keys", () => {
    expect(resolveLayout("custom:x").key).toBe("CLASSIC");
    expect(resolveLayout(undefined).key).toBe("CLASSIC");
    expect(resolveLayout(null).key).toBe(FALLBACK_LAYOUT);
    expect(resolveLayout("LINKS").key).toBe("LINKS");
    expect(resolveLayout("SCHEDULE").key).toBe("SCHEDULE");
  });

  it("registers five layouts with their labels, thumbnail alts and compositions", () => {
    const layouts = Object.entries(LAYOUT_REGISTRY);
    expect(layouts.map(([key]) => key)).toEqual(["CLASSIC", "SCHEDULE", "CIRCLES", "EXCHANGE", "LINKS"]);
    for (const [key, layout] of layouts) {
      expect(layout.key).toBe(key);
      expect(layout.thumbnail.alt).toBe(`Szkic układu ${layout.label}`);
    }
    expect(layouts.map(([, layout]) => layout.label)).toEqual([
      "Klasyczny",
      "Plan zajęć",
      "Grupy",
      "Wymiana",
      "Wizytówka",
    ]);

    const composition = (key: string) =>
      LAYOUT_REGISTRY[key].blocks.map(
        (slot) => `${slot.block}${slot.variant ? `:${slot.variant}` : ""}${slot.primary ? "*" : ""}`,
      );
    expect(composition("CLASSIC")).toEqual([
      "hero:cover",
      "share",
      "stats",
      "about",
      "upcoming-terms:list*",
      "exchange-counts:tiles3",
      "footer",
    ]);
    expect(composition("SCHEDULE")).toEqual([
      "hero:compact",
      "next-term-cta:card",
      "agenda:by-day*",
      "about",
      "exchange-counts:tiles3",
      "footer",
    ]);
    expect(composition("CIRCLES")).toEqual([
      "hero:cover",
      "share",
      "circles-grid:cards*",
      "circles-grid:featured*",
      "about",
      "exchange-counts:tiles3",
      "footer",
    ]);
    expect(composition("EXCHANGE")).toEqual([
      "hero:compact",
      "exchange-board:grid2*",
      "needed-items:list",
      "upcoming-terms:compact",
      "about",
      "footer",
    ]);
    expect(composition("LINKS")).toEqual(["hero:centered", "link-stack*", "about", "footer"]);
  });

  it("keeps exactly one active primary slot for 0, 1 and 2 circles, with CIRCLES featured at 1 and cards at 2", () => {
    for (const circles of [0, 1, 2]) {
      for (const layout of Object.values(LAYOUT_REGISTRY)) {
        const primaries = layout.blocks.filter((slot) => slot.primary && slotMatches(slot, circles));
        expect(primaries, `${layout.key} with ${circles} circles`).toHaveLength(1);
      }
    }

    renderLayout("CIRCLES", pageData({ circles: [circle("g1", "Orliki 2017")] }));
    expect(screen.getByRole("heading", { name: "Nasza grupa" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Nasze grupy" })).not.toBeInTheDocument();
    cleanup();

    renderLayout("CIRCLES", pageData({ circles: [circle("g1", "Orliki 2017"), circle("g2", "Młodziki 2015")] }));
    expect(screen.getByRole("heading", { name: "Nasze grupy" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Nasza grupa" })).not.toBeInTheDocument();
  });

  it("renders one skeleton per directory block id while the directory loads", () => {
    const { container } = renderLayout("CIRCLES", loading);

    // circles-grid (one for both `when` variants) and exchange-counts.
    expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(2);
    expect(screen.getByRole("heading", { level: 1, name: "Rodzinny Grajdołek" })).toBeInTheDocument();
    expect(screen.getByText("Strona utworzona w domena.pl")).toBeInTheDocument();
  });

  it("hides directory slots from visitors and shows neutral ghosts to the owner when unavailable", () => {
    const { container } = renderLayout("SCHEDULE", unavailable);

    expect(screen.getByText("Brak informacji do pokazania")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Udostępnij stronę" })).toBeInTheDocument();
    expect(screen.queryByText("NAJBLIŻSZE ZAJĘCIA")).not.toBeInTheDocument();
    expect(container.querySelector("[data-ghost], [aria-busy]")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Rodzinny Grajdołek" })).toBeInTheDocument();
    expect(screen.getByText("Strona utworzona w domena.pl")).toBeInTheDocument();
    cleanup();

    const owner = renderLayout("SCHEDULE", unavailable, "owner-edit");
    const ghosts = Array.from(owner.container.querySelectorAll("[data-ghost]"), (ghost) =>
      ghost.getAttribute("data-ghost"),
    );
    expect(ghosts).toEqual(["next-term-cta", "agenda", "about", "exchange-counts"]);
    expect(
      screen.getAllByText("Nie udało się wczytać danych. Odwiedzający nie widzą tej sekcji."),
    ).toHaveLength(3);
    expect(screen.queryByRole("link", { name: /Dodaj/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Brak informacji do pokazania")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Rodzinny Grajdołek" })).toBeInTheDocument();
  });

  it("gives an empty primary the layout's empty state for visitors and the CTA ghost for the owner", () => {
    const cases = [
      { key: "SCHEDULE", title: "Brak zaplanowanych zajęć", block: "agenda", cta: "Dodaj termin →" },
      { key: "CIRCLES", title: "Brak grup do pokazania", block: "circles-grid", cta: "Dodaj grupę →" },
      { key: "EXCHANGE", title: "Na razie nic tu nie ma", block: "exchange-board", cta: "Dodaj rzecz do wymiany →" },
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
    const soon = [1, 3, 6, 13].map((days, index) => term(`t${index}`, inDays(days)));
    const busy = pageData({
      circles: [circle("g1", "Orliki 2017"), circle("g2", "Młodziki 2015")],
      upcoming_terms: soon,
      exchange: { counts: { GIFT: 1, SWAP: 2, LEND: 1 }, items: [] },
    });

    expect(recommended(data)).toEqual(["LINKS"]);
    expect(recommended(unavailable)).toEqual(["LINKS"]);
    expect(recommended(loading)).toEqual([]);
    expect(recommended(busy)).toEqual(["SCHEDULE", "CIRCLES", "EXCHANGE"]);
    expect(
      recommended(
        pageData({
          circles: [circle("g1", "Orliki 2017")],
          upcoming_terms: [...soon.slice(0, 3), term("late", inDays(20))],
          exchange: { counts: { GIFT: 1, SWAP: 1, LEND: 1 }, items: [] },
        }),
      ),
    ).toEqual([]);
  });

  it("renders the LINKS directory buttons per state and the SCHEDULE compact hero", () => {
    const nearest = term("t1", "2026-10-14T17:00:00");
    const ready = pageData({
      circles: [circle("g1", "Orliki 2017")],
      upcoming_terms: [nearest],
      exchange: {
        counts: { GIFT: 3, SWAP: 4, LEND: 1 },
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
          },
        ],
      },
      stats: { circle_count: 1, upcoming_term_count: 9, family_count: null },
    });

    const { container } = renderLayout("LINKS", ready);
    const actions = Array.from(container.querySelectorAll("a, button"));
    expect(actions.map((action) => action.textContent)).toEqual([
      `Najbliższe zajęcia · ${dayjs(nearest.occurs_on).format("dd D.MM HH:mm")}`,
      "Wszystkie terminy (9)",
      "Wymiana rzeczy (8)",
      "Udostępnij stronę",
    ]);
    expect(actions[0]).toHaveAttribute("href", `/${SLUG}/grupa/g1/term/t1`);
    expect(actions[0]).toHaveClass("bg-primary");
    expect(actions[1]).toHaveAttribute("href", `/${SLUG}/terminy`);
    expect(actions[2]).toHaveAttribute("href", `/${SLUG}/grupa/g2/term/t9`);
    expect(actions[3]).not.toHaveClass("bg-primary");
    cleanup();

    const whileLoading = renderLayout("LINKS", loading);
    expect(whileLoading.container.querySelectorAll(".animate-pulse")).toHaveLength(2);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Udostępnij stronę" })).toBeInTheDocument();
    cleanup();

    renderLayout("LINKS", unavailable);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Udostępnij stronę" })).toHaveClass("bg-primary");
    cleanup();

    renderLayout("SCHEDULE", ready);
    const hero = screen.getByRole("heading", { level: 1, name: "Rodzinny Grajdołek" }).closest("header")!;
    expect(hero).toHaveClass("bg-paper", "border-b", "border-line");
    expect(within(hero).getByText(`domena.pl/${SLUG}`)).toBeInTheDocument();
    expect(within(hero).getByRole("button", { name: "Udostępnij" })).toHaveClass("min-h-[44px]");
  });

  it("recommends nothing while loading, even with a directory that would recommend SCHEDULE and CIRCLES", () => {
    const busy = pageData({
      circles: [circle("g1", "Orliki 2017"), circle("g2", "Młodziki 2015")],
      upcoming_terms: [1, 2, 3, 4].map((days, index) => term(`t${index}`, inDays(days))),
    });
    const stillLoading: OrganizerPageData = { ...busy, directoryStatus: "loading" };

    expect(isRecommended(LAYOUT_REGISTRY.SCHEDULE, busy)).toBe(true);
    expect(isRecommended(LAYOUT_REGISTRY.CIRCLES, busy)).toBe(true);
    expect(Object.values(LAYOUT_REGISTRY).filter((layout) => isRecommended(layout, stillLoading))).toEqual([]);
  });

  it("never renders identity fields smuggled into the directory on a full CLASSIC page", () => {
    const identity = { lister_party_id: "party-secret-1", lister_display_name: "Kasia Wójcik", avatar_url: "avatar.png" };
    const full = pageData({
      circles: [circle("g1", "Orliki 2017"), circle("g2", "Młodziki 2015")],
      upcoming_terms: [{ ...term("t1", inDays(2)), ...identity } as OrganizerTerm],
      exchange: {
        counts: { GIFT: 1, SWAP: 0, LEND: 0 },
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
            ...identity,
          },
        ],
      },
      stats: { circle_count: 2, upcoming_term_count: 1, family_count: 4 },
    });

    const { container } = renderLayout("CLASSIC", full);

    expect(screen.getByText("Orliki 2017")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Oddam\s*1/ })).toHaveAttribute("href", `/${SLUG}/grupa/g1/term/t1`);
    expect(container.textContent).not.toMatch(/Kasia|Wójcik|party-secret/);
    expect(container.innerHTML).not.toMatch(/party-secret|avatar\.png/);
  });

  it("loads the next agenda page for the organizer slug through the SCHEDULE layout", async () => {
    vi.mocked(groupsApi.getOrganizerTerms).mockImplementation(async (_slug, page) =>
      page === 1
        ? { items: [term("t1", "2026-10-14T17:00:00")], total: 21, page: 1, size: 20 }
        : { items: [term("t2", "2026-10-16T17:00:00")], total: 21, page: 2, size: 20 },
    );

    renderLayout(
      "SCHEDULE",
      pageData({ circles: [circle("g1", "Orliki 2017")], upcoming_terms: [term("t1", "2026-10-14T17:00:00")] }),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Pokaż kolejne terminy" }));

    expect(await screen.findByRole("heading", { level: 3, name: "piątek, 16 października" })).toBeInTheDocument();
    expect(groupsApi.getOrganizerTerms).toHaveBeenLastCalledWith(SLUG, 2, undefined);
  });

  it("copies origin/slug without the edit param when navigator.share is missing", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    window.history.pushState({}, "", "/rodzinny-grajdolek?edit=1");

    renderLayout("CLASSIC", data, "owner-edit");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Udostępnij" }));
    });

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/rodzinny-grajdolek`);
    expect(screen.getByRole("status")).toHaveTextContent("Skopiowano link");
    window.history.pushState({}, "", "/");
  });
});
