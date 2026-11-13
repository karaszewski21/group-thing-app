import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as categoriesApi from "../api/categories";
import { ApiError } from "../api/client";
import type { Category } from "../api/categories";
import * as searchApi from "../api/search";
import type { SearchPage, SearchQuery, SearchResult } from "../api/search";
import { SearchView } from "../features/search/SearchView";
import { createQueryWrapper, createTestQueryClient } from "./queryClient";
import { getTestLocation, renderWithRoute } from "./renderWithRoute";

vi.mock("../api/search", () => ({ searchPublic: vi.fn() }));
vi.mock("../api/categories", () => ({ getCategories: vi.fn() }));

let mockAuth: { token: string | null; username: string | null } = { token: "test-token", username: "anna" };
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));

const NO_FILTERS: SearchQuery["filters"] = {
  category: null,
  condition: null,
  offer_type: null,
  date_from: null,
  date_to: null,
};

function category(id: string, name: string, parent_id: string | null): Category {
  return {
    id,
    name,
    description: null,
    parent_id,
    sort_order: 0,
    product_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

const CATEGORIES: Category[] = [category("kids", "Dzieci", null), category("toys", "Zabawki", "kids")];

function product(id: string, title: string, reserved = false, reservedUntil: string | null = null): SearchResult {
  return {
    kind: "product",
    id,
    title,
    subtitle: null,
    href: `/zielony-krag/product/${id}`,
    meta: { mode: "GIFT", condition: "GOOD", thumb_url: null, reserved, reserved_until: reservedUntil },
  };
}

function page(items: SearchResult[], otherModeCount = 0, total = items.length): SearchPage {
  return { items, total, page: 1, size: 20, other_mode_count: otherModeCount };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A 503 is not retried, so the failure shows at once (`useSearch`'s `retry`).
const TIMEOUT_MESSAGE = "Wyszukiwanie trwa zbyt długo. Spróbuj zawęzić zapytanie.";

function timeout(): ApiError {
  return new ApiError(503, "Service Unavailable", { status: 503, error: "Service Unavailable", message: TIMEOUT_MESSAGE });
}

function renderSearch(url: string, client = createTestQueryClient()) {
  return renderWithRoute(<SearchView />, { url, pattern: "/search", wrapper: createQueryWrapper(client) });
}

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth = { token: "test-token", username: "anna" };
  vi.mocked(categoriesApi.getCategories).mockResolvedValue(CATEGORIES);
  vi.mocked(searchApi.searchPublic).mockResolvedValue(page([]));
});

describe("SearchView", () => {
  it("switching the mode keeps q and clears the filters", async () => {
    renderSearch("/search?q=klocki&condition=GOOD&offer_type=GIFT");

    fireEvent.click(await screen.findByRole("tab", { name: "Spotkania" }));

    expect(getTestLocation()).toEqual({ pathname: "/search", search: "?q=klocki&mode=events" });
  });

  it("hides the scope control from a guest and shows it, on Moje grupy, to a member", async () => {
    mockAuth = { token: null, username: null };
    const { unmount } = renderSearch("/search?q=klocki");
    expect(screen.queryByRole("radiogroup", { name: "Zakres" })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(searchApi.searchPublic).toHaveBeenCalledWith(
        { q: "klocki", mode: "items", scope: "all", filters: NO_FILTERS },
        1,
        20,
      ),
    );
    unmount();

    mockAuth = { token: "test-token", username: "anna" };
    renderSearch("/search?q=klocki");
    const scope = screen.getByRole("radiogroup", { name: "Zakres" });
    expect(within(scope).getByRole("radio", { name: "Moje grupy" })).toHaveAttribute("aria-checked", "true");
    expect(within(scope).getByRole("radio", { name: "Wszędzie" })).toHaveAttribute("aria-checked", "false");
  });

  it("caps the search input at the backend's 100 characters", async () => {
    renderSearch("/search");

    expect(await screen.findByRole("searchbox")).toHaveAttribute("maxLength", "100");
  });

  it("under 2 characters shows the hint and sends no request", async () => {
    renderSearch("/search?q=k");

    expect(screen.getByText("Wpisz co najmniej 2 znaki, żeby zacząć szukać.")).toBeInTheDocument();
    await act(() => sleep(400));
    expect(searchApi.searchPublic).not.toHaveBeenCalled();
    expect(screen.queryByText(/pasuj/)).not.toBeInTheDocument();
  });

  it("an empty items list offers the „szukam” link with the encoded q and a highlighted other-mode line", async () => {
    vi.mocked(searchApi.searchPublic).mockResolvedValue(page([], 2));
    renderSearch("/search?q=rowerek%20biegowy");

    expect(await screen.findByRole("heading", { name: "Nikt w Twoich grupach tego nie oddaje" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dodaj do listy „szukam”" })).toHaveAttribute(
      "href",
      "/add/hunting?name=rowerek%20biegowy",
    );
    expect(screen.getByText("0 przedmiotów dla „rowerek biegowy”")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /2 spotkania pasują do „rowerek biegowy”/ })).toHaveAttribute(
      "data-highlighted",
      "true",
    );
  });

  it("the other-mode line switches the mode and keeps q", async () => {
    vi.mocked(searchApi.searchPublic).mockResolvedValue(page([product("a", "Klocki drewniane")], 3));
    renderSearch("/search?q=klocki&scope=all");

    fireEvent.click(await screen.findByRole("button", { name: /3 spotkania pasują do „klocki”/ }));

    expect(getTestLocation()).toEqual({ pathname: "/search", search: "?q=klocki&scope=all&mode=events" });
  });

  it("renders reserved items with and without the reservation date", async () => {
    vi.mocked(searchApi.searchPublic).mockResolvedValue(
      page([
        product("a", "Kurtka zimowa 104", true, "2026-11-20T17:00:00"),
        product("b", "Śpiworek do wózka", true, null),
        product("c", "Klocki drewniane"),
      ]),
    );
    renderSearch("/search?q=dziecięce");

    expect(await screen.findByText("Zarezerwowana do pt 20 lis")).toBeInTheDocument();
    expect(screen.getByText("Zarezerwowana")).toBeInTheDocument();
    expect(screen.getAllByText(/Zarezerwowana/)).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Klocki drewniane" })).toHaveAttribute("href", "/zielony-krag/product/c");
    expect(screen.getByText("3 przedmioty dla „dziecięce”")).toBeInTheDocument();
  });

  it("restores the URL state on mount and renders meetings by kind", async () => {
    vi.mocked(searchApi.searchPublic).mockResolvedValue(
      page([
        {
          kind: "term",
          id: "t1",
          title: "Wymianka ubranek",
          subtitle: "Fundacja Dobre Ręce",
          href: "/fundacja/term/t1",
          meta: { starts_at: "2026-11-19T17:00:00", place: "Kraków, Podgórze", in_my_groups: true },
        },
        {
          kind: "organization",
          id: "o1",
          title: "Dziecięcy Świat",
          subtitle: null,
          href: "/dzieciecy-swiat",
          meta: { slug: "dzieciecy-swiat" },
        },
      ]),
    );
    renderSearch("/search?q=dzieci%C4%99ce&mode=events&scope=all&date_from=2026-11-20");

    expect(screen.getByRole("searchbox")).toHaveValue("dziecięce");
    expect(screen.getByRole("tab", { name: "Spotkania" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("radio", { name: "Wszędzie" })).toHaveAttribute("aria-checked", "true");
    expect(searchApi.searchPublic).toHaveBeenCalledWith(
      { q: "dziecięce", mode: "events", scope: "all", filters: { ...NO_FILTERS, date_from: "2026-11-20" } },
      1,
      20,
    );

    const term = await screen.findByRole("link", { name: /Wymianka ubranek/ });
    expect(term).toHaveAttribute("href", "/fundacja/term/t1");
    expect(term).toHaveTextContent("Termin");
    expect(term).toHaveTextContent("moja grupa");
    expect(term).toHaveTextContent("Fundacja Dobre Ręce · 17:00 · Kraków, Podgórze");
    const organization = screen.getByRole("link", { name: /Dziecięcy Świat/ });
    expect(organization).toHaveTextContent("Organizacja");
    expect(organization).toHaveTextContent("/dzieciecy-swiat");
  });

  it("shows a group's description clamped to two lines and no description line without one", async () => {
    vi.mocked(searchApi.searchPublic).mockResolvedValue(
      page([
        {
          kind: "group",
          id: "g1",
          title: "Mamy z Ruczaju",
          subtitle: "Fundacja Dobre Ręce",
          href: "/fundacja/group/g1/terms",
          meta: {
            description: "Co miesiąc wymieniamy się ubrankami.\nSpotykamy się w świetlicy.",
            next_starts_at: null,
            in_my_groups: false,
          },
        },
        {
          kind: "group",
          id: "g2",
          title: "Sąsiedzka szafa",
          subtitle: null,
          href: "/fundacja/group/g2/term/t9",
          meta: { description: null, next_starts_at: "2026-11-27T18:00:00", in_my_groups: false },
        },
      ]),
    );
    renderSearch("/search?q=ubranka&mode=events");

    const described = await screen.findByRole("link", { name: /Mamy z Ruczaju/ });
    const description = within(described).getByText(/Co miesiąc wymieniamy się ubrankami/);
    expect(description).toHaveClass("line-clamp-2", "text-ink");
    expect(described).toHaveTextContent("Fundacja Dobre Ręce");

    const plain = screen.getByRole("link", { name: /Sąsiedzka szafa/ });
    expect(plain.querySelector(".line-clamp-2")).toBeNull();
    expect(plain).toHaveTextContent("najbliższe spotkanie: pt 27 lis, 18:00");
  });

  it("a failed first page shows the error instead of an empty state", async () => {
    vi.mocked(searchApi.searchPublic).mockRejectedValue(timeout());
    renderSearch("/search?q=klocki");

    expect(await screen.findByRole("alert")).toHaveTextContent(TIMEOUT_MESSAGE);
    expect(screen.queryByRole("heading", { name: "Nikt w Twoich grupach tego nie oddaje" })).not.toBeInTheDocument();
    expect(screen.queryByText(/pasuj/)).not.toBeInTheDocument();
  });

  it("a failed refresh keeps the results and shows the error above them", async () => {
    const client = createTestQueryClient();
    vi.mocked(searchApi.searchPublic).mockResolvedValue(page([product("a", "Klocki drewniane")]));
    renderSearch("/search?q=klocki", client);
    expect(await screen.findByRole("link", { name: "Klocki drewniane" })).toBeInTheDocument();

    vi.mocked(searchApi.searchPublic).mockRejectedValue(timeout());
    await act(() => client.refetchQueries());

    expect(await screen.findByRole("alert")).toHaveTextContent(TIMEOUT_MESSAGE);
    expect(screen.getByRole("link", { name: "Klocki drewniane" })).toBeInTheDocument();
    expect(screen.getByText("1 przedmiot dla „klocki”")).toBeInTheDocument();
  });

  it("lets a guest pick a category from the public tree", async () => {
    mockAuth = { token: null, username: null };
    renderSearch("/search?q=klocki");

    fireEvent.click(screen.getByRole("button", { name: /Kategoria/ }));
    const sheet = await screen.findByRole("dialog", { name: "Wybierz kategorię" });
    fireEvent.click(await within(sheet).findByRole("button", { name: /Dzieci/ }));
    fireEvent.click(await within(sheet).findByRole("button", { name: /Zabawki/ }));

    await waitFor(() => expect(getTestLocation().search).toBe("?q=klocki&category=toys"));
  });

  it("two filter changes in the same tick both land in the URL", async () => {
    renderSearch("/search?q=klocki");

    act(() => {
      fireEvent.change(screen.getByRole("combobox", { name: "Stan" }), { target: { value: "GOOD" } });
      fireEvent.click(screen.getByRole("button", { name: "oddam" }));
    });

    expect(getTestLocation().search).toBe("?q=klocki&condition=GOOD&offer_type=GIFT");
  });

  it("an inverted date range shows an inline error at „Do” and sends no request", async () => {
    renderSearch("/search?q=joga&mode=events&date_from=2026-11-20&date_to=2026-11-19");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Data „Do” nie może być wcześniejsza niż „Od”.");
    const to = screen.getByLabelText("Do:");
    expect(to).toHaveAttribute("aria-invalid", "true");
    expect(to).toHaveAttribute("aria-describedby", alert.id);
    expect(screen.getByText("Popraw daty, żeby zobaczyć spotkania.")).toBeInTheDocument();
    await act(() => sleep(400));
    expect(searchApi.searchPublic).not.toHaveBeenCalled();

    fireEvent.change(to, { target: { value: "2026-11-21" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(searchApi.searchPublic).toHaveBeenCalledWith(
        {
          q: "joga",
          mode: "events",
          scope: "mine",
          filters: { ...NO_FILTERS, date_from: "2026-11-20", date_to: "2026-11-21" },
        },
        1,
        20,
      ),
    );
  });

  it("names the Kategoria trigger once, and with the picked category", async () => {
    const { unmount } = renderSearch("/search?q=klocki");
    expect(screen.getByRole("button", { name: "Kategoria" })).toHaveAttribute("aria-haspopup", "dialog");
    unmount();

    renderSearch("/search?q=klocki&category=toys");
    expect(await screen.findByRole("button", { name: /^Kategoria Dzieci .*Zabawki$/ })).toBeInTheDocument();
  });

  it("drops a scope from a guest's URL and the default scope from a member's", async () => {
    mockAuth = { token: null, username: null };
    const { unmount } = renderSearch("/search?q=kar&scope=mine");
    await waitFor(() => expect(getTestLocation().search).toBe("?q=kar"));
    unmount();

    mockAuth = { token: "test-token", username: "anna" };
    renderSearch("/search?q=kar&scope=all");
    await act(() => sleep(0));
    expect(getTestLocation().search).toBe("?q=kar&scope=all");
  });
});
