import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as groupsApi from "../api/groups";
import type { OrganizerTerm } from "../api/groups";
import type { Page } from "../api/pagination";
import { useOrganizerTerms } from "../hooks/useOrganizerTerms";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/groups", () => ({
  getOrganizerTerms: vi.fn(),
}));

function term(id: string, groupId = "c1"): OrganizerTerm {
  return {
    term_id: id,
    group_id: groupId,
    group_name: "Maluchy",
    occurs_on: "2026-10-12T10:00:00Z",
    description: null,
    attendee_count: 2,
  };
}

function page(items: OrganizerTerm[], pageNumber: number, total: number): Page<OrganizerTerm> {
  return { items, total, page: pageNumber, size: 20 };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("useOrganizerTerms", () => {
  it("appends the next page to the flattened terms until the last page", async () => {
    const first = Array.from({ length: 20 }, (_, i) => term(`t${i}`));
    vi.mocked(groupsApi.getOrganizerTerms).mockImplementation(async (_slug, pageNumber) =>
      pageNumber === 1 ? page(first, 1, 21) : page([term("t20")], 2, 21),
    );

    const { result } = renderHook(() => useOrganizerTerms("studio-ania"), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.terms).toHaveLength(20);
    expect(result.current.total).toBe(21);
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.terms).toHaveLength(21));
    expect(result.current.terms[20].term_id).toBe("t20");
    expect(result.current.hasNextPage).toBe(false);
    expect(groupsApi.getOrganizerTerms).toHaveBeenLastCalledWith("studio-ania", 2, undefined);
  });

  it("refetches with group_id when groupId changes", async () => {
    vi.mocked(groupsApi.getOrganizerTerms).mockImplementation(async (_slug, _page, groupId) =>
      page([term(groupId ?? "all", groupId ?? "c1")], 1, 1),
    );

    const { result, rerender } = renderHook(
      ({ groupId }: { groupId?: string }) => useOrganizerTerms("studio-ania", groupId),
      { wrapper: createQueryWrapper(), initialProps: {} },
    );
    await waitFor(() => expect(result.current.terms[0]?.term_id).toBe("all"));

    rerender({ groupId: "c2" });

    await waitFor(() => expect(result.current.terms[0]?.term_id).toBe("c2"));
    expect(groupsApi.getOrganizerTerms).toHaveBeenLastCalledWith("studio-ania", 1, "c2");
  });

  it("issues no request while disabled", async () => {
    const { result } = renderHook(() => useOrganizerTerms("studio-ania", "c1", { enabled: false }), {
      wrapper: createQueryWrapper(),
    });

    await act(async () => {});
    expect(groupsApi.getOrganizerTerms).not.toHaveBeenCalled();
    expect(result.current.terms).toEqual([]);
  });
});
