import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as groupsApi from "../api/groups";
import type { ModerationGroupResponse } from "../api/groups";
import { useModerationGroups } from "../hooks/useModerationGroups";
import { pageOf } from "./page";
import { createQueryWrapper, createTestQueryClient } from "./queryClient";

vi.mock("../api/groups", () => ({
  getGroupsForModeration: vi.fn(),
  restoreGroup: vi.fn(),
}));

const deletedGroup: ModerationGroupResponse = {
  id: "g1",
  name: "Krąg Mokotów",
  created_at: "2026-09-01T10:00:00",
  organizer_name: "Anna Nowak",
  organizer_email: "anna@example.com",
  member_count: 4,
  term_count: 2,
  deleted_at: "2026-10-10T12:00:00",
  deleted_by_name: "Anna Nowak",
};

describe("useModerationGroups", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(groupsApi.getGroupsForModeration).mockResolvedValue(pageOf([deletedGroup]));
  });

  it("requests getGroupsForModeration(page, deleted) and keys by deleted", async () => {
    const { result, rerender } = renderHook(
      ({ deleted }: { deleted: boolean }) => useModerationGroups(1, deleted),
      { wrapper: createQueryWrapper(), initialProps: { deleted: false } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(groupsApi.getGroupsForModeration).toHaveBeenCalledWith(1, false);

    rerender({ deleted: true });

    await waitFor(() => expect(groupsApi.getGroupsForModeration).toHaveBeenLastCalledWith(1, true));
    expect(result.current.data).toEqual([deletedGroup]);
  });

  it("keeps the previous page while the next page of the same listing loads", async () => {
    const { result, rerender } = renderHook(({ page }: { page: number }) => useModerationGroups(page, true), {
      wrapper: createQueryWrapper(),
      initialProps: { page: 1 },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    vi.mocked(groupsApi.getGroupsForModeration).mockReturnValue(new Promise(() => {}));

    rerender({ page: 2 });

    expect(result.current.data).toEqual([deletedGroup]);
  });

  it("does not carry rows across the deleted toggle while the other listing loads", async () => {
    const { result, rerender } = renderHook(
      ({ deleted }: { deleted: boolean }) => useModerationGroups(1, deleted),
      { wrapper: createQueryWrapper(), initialProps: { deleted: true } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    vi.mocked(groupsApi.getGroupsForModeration).mockReturnValue(new Promise(() => {}));

    rerender({ deleted: false });

    expect(result.current.data).toEqual([]);
    expect(result.current.loading).toBe(true);
  });

  it("restore calls restoreGroup and invalidates the moderationGroups prefix", async () => {
    vi.mocked(groupsApi.restoreGroup).mockResolvedValue(undefined);
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useModerationGroups(1, true), {
      wrapper: createQueryWrapper(client),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.restore("g1");

    expect(groupsApi.restoreGroup).toHaveBeenCalledWith("g1");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["moderationGroups"] });
  });

  it("restore rethrows extractProblemMessage(err)", async () => {
    vi.mocked(groupsApi.restoreGroup).mockRejectedValue(
      new ApiError(404, "Not Found", {
        type: "about:blank",
        title: "Not Found",
        status: 404,
        detail: "Group g1 not found",
      }),
    );
    const { result } = renderHook(() => useModerationGroups(1, true), {
      wrapper: createQueryWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.restore("g1")).rejects.toThrow("Group g1 not found");
  });
});
