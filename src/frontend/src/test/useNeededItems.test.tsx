import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as termsApi from "../api/terms";
import type { NeededItemResponse } from "../api/terms";
import { useNeededItems } from "../hooks/useNeededItems";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/terms", () => ({
  getNeededItemsForTerms: vi.fn(),
}));

function neededItem(id: string, termId: string, name: string): NeededItemResponse {
  return { id, term_id: termId, name, description: null, claimed: false, created_at: "", updated_at: "" };
}

describe("useNeededItems", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("reads every term's needs in one request and groups them by term", async () => {
    vi.mocked(termsApi.getNeededItemsForTerms).mockResolvedValue([
      neededItem("1", "term-a", "Bęben"),
      neededItem("2", "term-a", "Koc"),
      neededItem("3", "term-b", "Flet"),
    ]);

    const { result } = renderHook(() => useNeededItems(["term-b", "term-a", "term-b", "term-c"]), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(termsApi.getNeededItemsForTerms).toHaveBeenCalledTimes(1);
    expect(termsApi.getNeededItemsForTerms).toHaveBeenCalledWith(["term-a", "term-b", "term-c"]);
    expect(result.current.data.get("term-a")?.map((item) => item.name)).toEqual(["Bęben", "Koc"]);
    expect(result.current.data.get("term-b")?.map((item) => item.name)).toEqual(["Flet"]);
    expect(result.current.data.get("term-c")).toBeUndefined();
  });

  it("sends no request without terms", () => {
    const { result } = renderHook(() => useNeededItems([]), { wrapper: createQueryWrapper() });

    expect(result.current.loading).toBe(false);
    expect(result.current.data.size).toBe(0);
    expect(termsApi.getNeededItemsForTerms).not.toHaveBeenCalled();
  });

  it("refetch re-reads the needs", async () => {
    vi.mocked(termsApi.getNeededItemsForTerms).mockResolvedValue([]);
    const { result } = renderHook(() => useNeededItems(["term-a"]), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    vi.mocked(termsApi.getNeededItemsForTerms).mockResolvedValue([neededItem("1", "term-a", "Bęben")]);
    await result.current.refetch();

    await waitFor(() => expect(result.current.data.get("term-a")).toHaveLength(1));
    expect(termsApi.getNeededItemsForTerms).toHaveBeenCalledTimes(2);
  });
});
