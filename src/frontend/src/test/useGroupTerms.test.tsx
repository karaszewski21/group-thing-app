import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as termsApi from "../api/terms";
import type { TermResponse } from "../api/terms";
import { useGroupTerms } from "../hooks/useGroupTerms";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/terms", () => ({ getTerms: vi.fn() }));

describe("useGroupTerms", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("wrapsGetTerms_andDoesNotFetchWhileDisabled", async () => {
    const terms = [{ id: "t1", occurs_on: "2026-10-22T17:30:00" }] as TermResponse[];
    vi.mocked(termsApi.getTerms).mockResolvedValueOnce(terms);

    const disabled = renderHook(() => useGroupTerms("g1", { enabled: false }), { wrapper: createQueryWrapper() });
    await act(async () => {});
    expect(termsApi.getTerms).not.toHaveBeenCalled();
    expect(disabled.result.current.data).toEqual([]);
    const emptyBefore = disabled.result.current.data;
    disabled.rerender();
    expect(disabled.result.current.data).toBe(emptyBefore);

    const { result } = renderHook(() => useGroupTerms("g1", { enabled: true }), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(termsApi.getTerms).toHaveBeenCalledWith("g1");
    expect(result.current.data).toEqual(terms);
    expect(result.current.error).toBeNull();
  });
});
