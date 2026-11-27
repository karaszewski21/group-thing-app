import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as localitiesApi from "../api/localities";
import * as searchApi from "../api/search";
import type { SearchPage, SearchQuery, SearchResult } from "../api/search";
import { LandingPage } from "../features/landing/LandingPage";
import { LandingPageSkeleton } from "../features/home/HomeSkeleton";
import { makeLocality } from "./fixtures/locations";
import { createQueryWrapper } from "./queryClient";
import { renderWithRoute } from "./renderWithRoute";

vi.mock("../api/search", () => ({ searchPublic: vi.fn() }));
vi.mock("../api/localities", () => ({ getNearestLocality: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ token: null, username: null }) }));

const KETY = makeLocality();

function product(id: string, title: string): SearchResult {
  return {
    kind: "product",
    id,
    title,
    subtitle: null,
    href: `/ania/product/${id}`,
    meta: { mode: "GIFT", points_price: null, condition: "GOOD", thumb_url: null, reserved: false, reserved_until: null },
  };
}

function event(id: string, title: string): SearchResult {
  return {
    kind: "event",
    id,
    title,
    subtitle: "Ania",
    href: `/ania/event/${id}`,
    meta: { starts_at: "2026-12-05T10:00:00", place: "Kęty" },
  };
}

function page(items: SearchResult[], total: number, pageNumber = 1): SearchPage {
  return { items, total, page: pageNumber, size: items.length, other_mode_count: 0 };
}

interface Answers {
  items: SearchPage;
  events: SearchPage;
  nearItems?: SearchPage;
  nearEvents?: SearchPage;
}

/** Answers `searchPublic` by mode and by whether a locality is sent; any
 * second page is one more item. */
function answerSearch(answers: Answers) {
  vi.mocked(searchApi.searchPublic).mockImplementation(async ({ mode, filters }: SearchQuery, pageNumber: number) => {
    if (pageNumber > 1) return page([product("it-9", "Kalosze 25")], 2, 2);
    if (filters.locality) return (mode === "items" ? answers.nearItems : answers.nearEvents) ?? page([], 0);
    return mode === "items" ? answers.items : answers.events;
  });
}

function stubGeolocation(permission: PermissionState) {
  const getCurrentPosition = vi.fn((success: PositionCallback) =>
    success({ coords: { latitude: 49.88345, longitude: 19.22172 } } as GeolocationPosition),
  );
  vi.stubGlobal("navigator", {
    geolocation: { getCurrentPosition },
    permissions: { query: vi.fn().mockResolvedValue({ state: permission }) },
  });
  return getCurrentPosition;
}

function renderLanding() {
  return renderWithRoute(<LandingPage />, { url: "/", wrapper: createQueryWrapper() });
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LandingPage", () => {
  it("offers sign-up and lists the newest items and the soonest meetings with „Pokaż więcej”", async () => {
    stubGeolocation("prompt");
    answerSearch({ items: page([product("it-1", "Rowerek")], 2), events: page([event("ev-1", "Kiermasz")], 1) });

    renderLanding();

    expect(screen.getByRole("link", { name: "Załóż konto" })).toHaveAttribute("href", "/login?mode=register");
    expect(screen.getByRole("link", { name: "Mam już konto" })).toHaveAttribute("href", "/login");
    expect(await screen.findByRole("heading", { name: "Ostatnio dodane rzeczy" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Najbliższe spotkania" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Rowerek" })).toHaveAttribute("href", "/ania/product/it-1");
    expect(await screen.findByText("Kiermasz")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pokazać, co jest blisko Ciebie?" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pokaż więcej" }));

    expect(await screen.findByRole("link", { name: "Kalosze 25" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pokaż więcej" })).not.toBeInTheDocument();
  });

  it("lists what is near the visitor after they turn location on", async () => {
    const getCurrentPosition = stubGeolocation("prompt");
    vi.mocked(localitiesApi.getNearestLocality).mockResolvedValue(KETY);
    answerSearch({
      items: page([product("it-1", "Rowerek")], 1),
      events: page([event("ev-1", "Kiermasz")], 1),
      nearItems: page([product("it-2", "Fotelik")], 1),
      nearEvents: page([], 0),
    });

    renderLanding();
    fireEvent.click(await screen.findByRole("button", { name: "Włącz lokalizację" }));

    expect(await screen.findByRole("heading", { name: "Rzeczy w pobliżu" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Fotelik" })).toBeInTheDocument();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    // Rounded to about 1 km before it leaves the browser.
    expect(localitiesApi.getNearestLocality).toHaveBeenCalledWith(49.88, 19.22);
    expect(searchApi.searchPublic).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "items", filters: expect.objectContaining({ locality: KETY.id, radius: 25 }) }),
      1,
      8,
    );
    // No meetings near: the soonest from everywhere, and the section says so.
    expect(await screen.findByText("Kiermasz")).toBeInTheDocument();
    expect(screen.getByText("W pobliżu nic nie znaleźliśmy — pokazujemy najnowsze.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Włącz lokalizację" })).not.toBeInTheDocument();
  });

  it("uses a granted permission at once", async () => {
    const getCurrentPosition = stubGeolocation("granted");
    vi.mocked(localitiesApi.getNearestLocality).mockResolvedValue(KETY);
    answerSearch({
      items: page([], 0),
      events: page([], 0),
      nearItems: page([product("it-2", "Fotelik")], 1),
      nearEvents: page([event("ev-2", "Spacer")], 1),
    });

    renderLanding();

    expect(await screen.findByRole("link", { name: "Fotelik" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Spotkania w pobliżu" })).toBeInTheDocument();
    expect(await screen.findByText("Spacer")).toBeInTheDocument();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Włącz lokalizację" })).not.toBeInTheDocument();
  });

  it("lists within the picked radius and remembers it on the device", async () => {
    stubGeolocation("granted");
    vi.mocked(localitiesApi.getNearestLocality).mockResolvedValue(KETY);
    answerSearch({
      items: page([], 0),
      events: page([], 0),
      nearItems: page([product("it-2", "Fotelik")], 1),
      nearEvents: page([event("ev-2", "Spacer")], 1),
    });

    const first = renderLanding();
    const radii = await screen.findByRole("group", { name: "Odległość" });
    expect(within(radii).getAllByRole("button").map((chip) => chip.textContent)).toEqual([
      "Tylko tu",
      "+5 km",
      "+10 km",
      "+25 km",
      "+50 km",
    ]);
    expect(within(radii).getByRole("button", { name: "+25 km" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(within(radii).getByRole("button", { name: "+5 km" }));

    await waitFor(() =>
      expect(searchApi.searchPublic).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "events", filters: expect.objectContaining({ locality: KETY.id, radius: 5 }) }),
        1,
        4,
      ),
    );
    expect(screen.getAllByRole("link", { name: "Zobacz wszystkie" })[0]).toHaveAttribute(
      "href",
      `/search?mode=items&locality=${KETY.id}&radius=5`,
    );
    first.unmount();

    renderLanding();
    expect(await screen.findByRole("button", { name: "+5 km" })).toHaveAttribute("aria-pressed", "true");
  });

  it("remembers „Nie teraz” and keeps the newest, with a way to turn the location on", async () => {
    const getCurrentPosition = stubGeolocation("prompt");
    answerSearch({ items: page([], 0), events: page([], 0) });

    const first = renderLanding();
    fireEvent.click(await screen.findByRole("button", { name: "Nie teraz" }));
    expect(await screen.findByRole("button", { name: "Pokaż w pobliżu" })).toBeInTheDocument();
    first.unmount();

    renderLanding();

    expect(await screen.findByText("Nikt jeszcze nic nie dodał.")).toBeInTheDocument();
    expect(screen.getByText("Brak zaplanowanych spotkań i wydarzeń.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Włącz lokalizację" })).not.toBeInTheDocument();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("after turning the location off offers „Cofnij”, which turns it back on", async () => {
    const getCurrentPosition = stubGeolocation("granted");
    vi.mocked(localitiesApi.getNearestLocality).mockResolvedValue(KETY);
    answerSearch({
      items: page([product("it-1", "Rowerek")], 1),
      events: page([], 0),
      nearItems: page([product("it-2", "Fotelik")], 1),
      nearEvents: page([], 0),
    });

    renderLanding();
    expect(await screen.findByRole("link", { name: "Fotelik" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Wyłącz lokalizację" }));

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent("Lokalizacja wyłączona");
    fireEvent.click(within(notice).getByRole("button", { name: "Cofnij" }));

    expect(await screen.findByRole("link", { name: "Fotelik" })).toBeInTheDocument();
    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Lokalizacja wyłączona")).not.toBeInTheDocument();
  });

  it("„Twoja okolica” changes the radius and turns the location off", async () => {
    stubGeolocation("granted");
    vi.mocked(localitiesApi.getNearestLocality).mockResolvedValue(KETY);
    answerSearch({
      items: page([product("it-1", "Rowerek")], 1),
      events: page([], 0),
      nearItems: page([product("it-2", "Fotelik")], 1),
      nearEvents: page([], 0),
    });

    renderLanding();
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(`${KETY.name} · do 25 km`) }));

    const sheet = screen.getByRole("dialog", { name: "Twoja okolica" });
    fireEvent.click(within(sheet).getByRole("button", { name: "+10 km" }));
    expect(within(sheet).getByRole("button", { name: "+10 km" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(sheet).getByRole("button", { name: "Wyłącz lokalizację" }));

    expect(screen.queryByRole("dialog", { name: "Twoja okolica" })).not.toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Rowerek" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pokaż w pobliżu" })).toBeInTheDocument();
  });

  it("turns the location off, also over a granted permission, and back on", async () => {
    const getCurrentPosition = stubGeolocation("granted");
    vi.mocked(localitiesApi.getNearestLocality).mockResolvedValue(KETY);
    answerSearch({
      items: page([product("it-1", "Rowerek")], 1),
      events: page([], 0),
      nearItems: page([product("it-2", "Fotelik")], 1),
      nearEvents: page([], 0),
    });

    const first = renderLanding();
    expect(await screen.findByRole("link", { name: "Fotelik" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Wyłącz lokalizację" }));

    expect(await screen.findByRole("link", { name: "Rowerek" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ostatnio dodane rzeczy" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Odległość" })).not.toBeInTheDocument();
    first.unmount();

    // Off wins over the browser's granted permission on the next visit.
    renderLanding();
    expect(await screen.findByRole("link", { name: "Rowerek" })).toBeInTheDocument();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Pokaż w pobliżu" }));

    expect(await screen.findByRole("link", { name: "Fotelik" })).toBeInTheDocument();
    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem("home.location.declined")).toBeNull();
  });
});

describe("LandingPageSkeleton", () => {
  it("draws the hero, the location card and both sections in their grids while the page loads", () => {
    const { container } = renderWithRoute(<LandingPageSkeleton />, { url: "/" });

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByText("Wczytywanie…")).toHaveClass("sr-only");
    const items = container.querySelector('[aria-hidden="true"][class*="grid-cols-2"]');
    const meetings = container.querySelector('[aria-hidden="true"][class*="flex-col gap-2.5"]');
    expect(items?.children).toHaveLength(8);
    expect(meetings?.children).toHaveLength(4);
  });
});
