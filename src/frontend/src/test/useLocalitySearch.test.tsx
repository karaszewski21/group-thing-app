import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as localitiesApi from "../api/localities";
import { LOCALITIES_KEY, useLocalitySearch } from "../hooks/useLocalitySearch";
import { makeLocalitySearchResult } from "./fixtures/locations";
import { createQueryWrapper, createTestQueryClient } from "./queryClient";

vi.mock("../api/localities", () => ({ searchLocalities: vi.fn() }));

const KETY = makeLocalitySearchResult();

beforeEach(() => {
  vi.resetAllMocks();
});

describe("useLocalitySearch", () => {
  it("issues no request for a query shorter than 2 characters and keeps a stable empty result", async () => {
    const { result, rerender } = renderHook(({ q }) => useLocalitySearch(q), {
      initialProps: { q: " K " },
      wrapper: createQueryWrapper(),
    });
    const firstEmpty = result.current.data;
    await new Promise((resolve) => setTimeout(resolve, 400));
    rerender({ q: " K " });

    expect(localitiesApi.searchLocalities).not.toHaveBeenCalled();
    expect(result.current.data).toEqual([]);
    expect(result.current.data).toBe(firstEmpty);
    expect(result.current.total).toBe(0);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("debounces typing into one request keyed under the localities prefix", async () => {
    vi.mocked(localitiesApi.searchLocalities).mockResolvedValue({ results: [KETY], total: 3 });
    const client = createTestQueryClient();
    const { result, rerender } = renderHook(({ q }) => useLocalitySearch(q), {
      initialProps: { q: "Kę" },
      wrapper: createQueryWrapper(client),
    });
    rerender({ q: "Kęt" });
    rerender({ q: "Kęty " });

    await waitFor(() => expect(result.current.data).toEqual([KETY]));
    expect(result.current.total).toBe(3);
    expect(localitiesApi.searchLocalities).toHaveBeenCalledTimes(1);
    expect(localitiesApi.searchLocalities).toHaveBeenCalledWith("Kęty", 10);
    expect(client.getQueryData([...LOCALITIES_KEY, { q: "Kęty", limit: 10 }])).toEqual({ results: [KETY], total: 3 });
    expect(client.getQueryCache().getAll().every((q) => q.queryKey[0] === LOCALITIES_KEY[0])).toBe(true);
  });

  it("passes the backend's problem message through as error", async () => {
    vi.mocked(localitiesApi.searchLocalities).mockRejectedValue(
      new ApiError(422, "Unprocessable", { status: 422, title: "Unprocessable", detail: "Za dużo zapytań" }),
    );
    const { result } = renderHook(() => useLocalitySearch("32-6", 5), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.error).toBe("Za dużo zapytań"));
    expect(localitiesApi.searchLocalities).toHaveBeenCalledWith("32-6", 5);
    expect(result.current.data).toEqual([]);
  });
});
