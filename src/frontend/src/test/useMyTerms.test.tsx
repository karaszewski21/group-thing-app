import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as termsApi from "../api/terms";
import type { MyTermResponse } from "../api/terms";
import type { Page } from "../api/pagination";
import { ApiError } from "../api/client";
import { useMyTerms } from "../hooks/useMyTerms";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/terms", () => ({
  getMyTerms: vi.fn(),
}));

function term(id: string): MyTermResponse {
  return {
    id,
    group_id: "g1",
    occurs_on: "2026-11-12T17:00:00",
    description: null,
    attendee_count: 0,
    child_count: 0,
    location: null,
    capacity: null,
    group_name: "Maluchy",
    organizer_slug: "maluchy",
  };
}

function page(items: MyTermResponse[], pageNumber: number, total: number): Page<MyTermResponse> {
  return { items, total, page: pageNumber, size: 20 };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("useMyTerms", () => {
  it("appends the next page until the last one, asking for the same role", async () => {
    const first = Array.from({ length: 20 }, (_, i) => term(`t${i}`));
    vi.mocked(termsApi.getMyTerms).mockImplementation(async (_role, pageNumber) =>
      pageNumber === 1 ? page(first, 1, 21) : page([term("t20")], 2, 21),
    );

    const { result } = renderHook(() => useMyTerms("led"), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.terms).toHaveLength(20);
    expect(result.current.total).toBe(21);
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.terms).toHaveLength(21));
    expect(result.current.hasNextPage).toBe(false);
    expect(termsApi.getMyTerms).toHaveBeenNthCalledWith(1, "led", 1, expect.any(Number));
    expect(termsApi.getMyTerms).toHaveBeenLastCalledWith("led", 2, expect.any(Number));
  });

  it("keeps the loaded terms and reports a failed next page separately", async () => {
    vi.mocked(termsApi.getMyTerms)
      .mockResolvedValueOnce(page([term("t0")], 1, 21))
      .mockRejectedValueOnce(new ApiError(500, "Internal Server Error", null));

    const { result } = renderHook(() => useMyTerms("member"), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.nextPageError).not.toBeNull());
    expect(result.current.error).toBeNull();
    expect(result.current.terms.map((t) => t.id)).toEqual(["t0"]);
  });
});
