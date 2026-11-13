import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as searchApi from "../api/search";
import type { SearchPage, SearchQuery, SearchResult } from "../api/search";
import { useSearchUrlState } from "../features/search/useSearchUrlState";
import { SEARCH_MAX_PAGE, useSearch } from "../hooks/useSearch";
import { createQueryWrapper, createTestQueryClient } from "./queryClient";
import { getTestLocation, getTestRouter, routeWrapper } from "./renderWithRoute";

vi.mock("../api/search", () => ({ searchPublic: vi.fn() }));

const NO_FILTERS: SearchQuery["filters"] = {
  category: null,
  condition: null,
  offer_type: null,
  date_from: null,
  date_to: null,
};

function product(id: string): SearchResult {
  return {
    kind: "product",
    id,
    title: `Klocki ${id}`,
    subtitle: null,
    href: `/zielony-krag/product/${id}`,
    meta: { mode: "GIFT", condition: "GOOD", thumb_url: null, reserved: false, reserved_until: null },
  };
}

function page(ids: string[], pageNumber: number, total: number, otherModeCount: number): SearchPage {
  return { items: ids.map(product), total, page: pageNumber, size: 20, other_mode_count: otherModeCount };
}

function query(q: string): SearchQuery {
  return { q, mode: "items", scope: "mine", filters: NO_FILTERS };
}

const TIMEOUT_MESSAGE = "Wyszukiwanie trwa zbyt długo. Spróbuj zawęzić zapytanie.";

function timeout(): ApiError {
  return new ApiError(503, "Service Unavailable", {
    status: 503,
    error: "Service Unavailable",
    message: TIMEOUT_MESSAGE,
  });
}

/** Retries everything at once unless the hook sets its own `retry`. */
function retryingWrapper() {
  const client = createTestQueryClient();
  client.setDefaultOptions({ queries: { retry: 5, retryDelay: 0, gcTime: Infinity } });
  return createQueryWrapper(client);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  vi.resetAllMocks();
});

describe("useSearch", () => {
  it("sends no request for a folded q under 2 characters and reports the hint", async () => {
    const { result } = renderHook(() => useSearch(query("  ł "), "anna"), { wrapper: createQueryWrapper() });

    await act(() => sleep(400));

    expect(searchApi.searchPublic).not.toHaveBeenCalled();
    expect(result.current.tooShort).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.items).toEqual([]);
  });

  it("debounces typing by 300 ms and asks only for the settled, trimmed q", async () => {
    vi.mocked(searchApi.searchPublic).mockResolvedValue(page(["a"], 1, 1, 0));
    const { result, rerender } = renderHook(({ q }: { q: string }) => useSearch(query(q), "anna"), {
      wrapper: createQueryWrapper(),
      initialProps: { q: "k" },
    });
    rerender({ q: "kl" });
    rerender({ q: "klo" });
    rerender({ q: " klocki " });

    expect(result.current.loading).toBe(true);
    await act(() => sleep(150));
    expect(searchApi.searchPublic).not.toHaveBeenCalled();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(searchApi.searchPublic).toHaveBeenCalledTimes(1);
    expect(searchApi.searchPublic).toHaveBeenCalledWith(query("klocki"), 1, 20);
  });

  it("asks for a blank q at once: it browses", async () => {
    vi.mocked(searchApi.searchPublic).mockResolvedValue(page(["a"], 1, 1, 0));
    const { result } = renderHook(() => useSearch(query("  "), "anna"), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(searchApi.searchPublic).toHaveBeenCalledWith(query(""), 1, 20));
    expect(result.current.tooShort).toBe(false);
  });

  it("asks at once for a q restored from the URL on mount", async () => {
    vi.mocked(searchApi.searchPublic).mockResolvedValue(page(["a"], 1, 1, 0));
    renderHook(() => useSearch(query("klocki"), "anna"), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(searchApi.searchPublic).toHaveBeenCalledWith(query("klocki"), 1, 20));
  });

  it("pages while page*size < total and keeps other_mode_count from the first page", async () => {
    vi.mocked(searchApi.searchPublic).mockImplementation(async (_query, pageNumber) =>
      pageNumber === 1 ? page(["a", "b"], 1, 21, 3) : page(["c"], 2, 21, 99),
    );
    const { result } = renderHook(() => useSearch(query("klocki"), "anna"), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasNextPage).toBe(true);
    expect(result.current.total).toBe(21);
    expect(result.current.otherModeCount).toBe(3);

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual(["a", "b", "c"]));
    expect(result.current.hasNextPage).toBe(false);
    expect(result.current.otherModeCount).toBe(3);
  });

  it("stops paging at the backend's last page even when more results match", async () => {
    vi.mocked(searchApi.searchPublic).mockResolvedValue(page(["z"], SEARCH_MAX_PAGE, 5000, 0));
    const { result } = renderHook(() => useSearch(query("klocki"), "anna"), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(SEARCH_MAX_PAGE).toBe(50);
    expect(result.current.total).toBe(5000);
    expect(result.current.hasNextPage).toBe(false);
  });

  it("does not retry a timed-out search (503) and shows the server's message", async () => {
    vi.mocked(searchApi.searchPublic).mockRejectedValue(timeout());
    const { result } = renderHook(() => useSearch(query("klocki"), "anna"), { wrapper: retryingWrapper() });

    await waitFor(() => expect(result.current.error).toBe(TIMEOUT_MESSAGE));
    await act(() => sleep(50));
    expect(searchApi.searchPublic).toHaveBeenCalledTimes(1);
  });

  it("shows nginx's rate-limit envelope (429) as is, without retrying", async () => {
    const message = "Za dużo zapytań naraz. Odczekaj chwilę i spróbuj ponownie.";
    vi.mocked(searchApi.searchPublic).mockRejectedValue(
      new ApiError(429, "Too Many Requests", { status: 429, error: "Too Many Requests", message }),
    );
    const { result } = renderHook(() => useSearch(query("klocki"), "anna"), { wrapper: retryingWrapper() });

    await waitFor(() => expect(result.current.error).toBe(message));
    expect(searchApi.searchPublic).toHaveBeenCalledTimes(1);
  });

  it("still retries any other 5xx twice, as the app does", async () => {
    vi.mocked(searchApi.searchPublic).mockRejectedValue(new ApiError(502, "Bad Gateway", ""));
    const { result } = renderHook(() => useSearch(query("klocki"), "anna"), { wrapper: retryingWrapper() });

    await waitFor(() => expect(result.current.error).toBe("Bad Gateway (HTTP 502)"));
    expect(searchApi.searchPublic).toHaveBeenCalledTimes(3);
  });

  it("reports a failed next page as nextPageError and keeps the first page", async () => {
    vi.mocked(searchApi.searchPublic).mockImplementation(async (_query, pageNumber) => {
      if (pageNumber === 1) return page(["a", "b"], 1, 21, 3);
      throw timeout();
    });
    const { result } = renderHook(() => useSearch(query("klocki"), "anna"), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.nextPageError).toBe(TIMEOUT_MESSAGE));
    expect(searchApi.searchPublic).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
    expect(result.current.items.map((item) => item.id)).toEqual(["a", "b"]);
    expect(result.current.total).toBe(21);
  });

  it("keys the cache by viewer: another account or a guest asks again instead of reusing results", async () => {
    vi.mocked(searchApi.searchPublic).mockResolvedValue(page(["a"], 1, 1, 0));
    const { result, rerender } = renderHook(({ viewer }: { viewer: string | null }) => useSearch(query("klocki"), viewer), {
      wrapper: createQueryWrapper(),
      initialProps: { viewer: "anna" as string | null },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(searchApi.searchPublic).toHaveBeenCalledTimes(1);

    vi.mocked(searchApi.searchPublic).mockReturnValue(new Promise(() => {}));
    rerender({ viewer: "bartek" });
    expect(result.current.items).toEqual([]);
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(searchApi.searchPublic).toHaveBeenCalledTimes(2));

    rerender({ viewer: null });
    await waitFor(() => expect(searchApi.searchPublic).toHaveBeenCalledTimes(3));
  });
});

describe("useSearchUrlState", () => {
  it("reads the URL and, switching mode, keeps q and scope and clears the filters", () => {
    const { result } = renderHook(() => useSearchUrlState(false), {
      wrapper: routeWrapper({ url: "/search?q=klocki&scope=mine&category=c-1&condition=GOOD&offer_type=GIFT" }),
    });
    expect(result.current.mode).toBe("items");
    expect(result.current.scope).toBe("mine");
    expect(result.current.filters).toEqual({ ...NO_FILTERS, category: "c-1", condition: "GOOD", offer_type: "GIFT" });

    act(() => result.current.setMode("events"));

    expect(getTestLocation()).toEqual({ pathname: "/search", search: "?q=klocki&scope=mine&mode=events" });
    expect(result.current.filters).toEqual(NO_FILTERS);
  });

  it("forces a guest's scope to 'all' and never writes it to the URL", () => {
    const { result } = renderHook(() => useSearchUrlState(true), {
      wrapper: routeWrapper({ url: "/search?q=kl&scope=mine" }),
    });
    expect(result.current.scope).toBe("all");

    act(() => result.current.setQ("klocki"));

    expect(getTestLocation()).toEqual({ pathname: "/search", search: "?q=klocki" });
    expect(getTestRouter().calls.at(-1)).toMatchObject({ method: "replace", scroll: false });
    expect(result.current.q).toBe("klocki");
  });
});
