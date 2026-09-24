import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as groupsApi from "../api/groups";
import type { GroupAccessResponse } from "../api/groups";
import { useTermAccess } from "../hooks/useTermAccess";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/groups", () => ({ getGroupAccess: vi.fn() }));

const mockAuth: { token: string | null } = { token: null };
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));

function access(name: string): GroupAccessResponse {
  return { group: { name }, access: { is_member: false } } as unknown as GroupAccessResponse;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function renderReady(initial: GroupAccessResponse) {
  vi.mocked(groupsApi.getGroupAccess).mockResolvedValueOnce(initial);
  const hook = renderHook(() => useTermAccess(1, 2), { wrapper: createQueryWrapper() });
  await waitFor(() => expect(hook.result.current.state.status).toBe("ready"));
  return hook;
}

describe("useTermAccess", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAuth.token = null;
  });

  it("refetch_error_keepsReadyWithRefreshError", async () => {
    const { result } = await renderReady(access("A"));
    vi.mocked(groupsApi.getGroupAccess).mockRejectedValueOnce(new Error("boom"));

    await act(() => result.current.refetch());

    const { state } = result.current;
    expect(state.status).toBe("ready");
    if (state.status !== "ready") return;
    expect(state.data).toEqual(access("A"));
    expect(state.refreshError).toBe("boom");
  });

  it("firstLoad_error_givesErrorState", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockRejectedValueOnce(new Error("404 Not Found"));

    const { result } = renderHook(() => useTermAccess(1, 2), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.state).toEqual({ status: "error", message: "404 Not Found" }));
  });

  it("overlappingRefetches_latestRequestWins", async () => {
    const { result } = await renderReady(access("A"));
    const older = deferred<GroupAccessResponse>();
    const newer = deferred<GroupAccessResponse>();
    vi.mocked(groupsApi.getGroupAccess).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.refetch();
      second = result.current.refetch();
    });
    await act(async () => {
      newer.resolve(access("newer"));
      await second;
    });
    await act(async () => {
      older.resolve(access("older"));
      await first;
    });

    const { state } = result.current;
    expect(state.status === "ready" && state.data).toEqual(access("newer"));
  });

  it("tokenChange_isStaleUntilResponseArrives", async () => {
    const hook = await renderReady(access("anon"));
    expect(hook.result.current.isStale).toBe(false);
    const pending = deferred<GroupAccessResponse>();
    vi.mocked(groupsApi.getGroupAccess).mockReturnValueOnce(pending.promise);

    mockAuth.token = "t2";
    hook.rerender();

    expect(hook.result.current.isStale).toBe(true);
    await act(async () => {
      pending.resolve(access("user"));
      await pending.promise;
    });
    expect(hook.result.current.isStale).toBe(false);
    const { state } = hook.result.current;
    expect(state.status === "ready" && state.data).toEqual(access("user"));
  });

  it("tokenChangeFetch_fails_keepsStaleReadyWithRefreshError_untilRefetchSucceeds", async () => {
    const hook = await renderReady(access("anon"));
    vi.mocked(groupsApi.getGroupAccess).mockRejectedValueOnce(new Error("net down"));

    mockAuth.token = "t2";
    hook.rerender();
    await waitFor(() => {
      const { state } = hook.result.current;
      expect(state.status === "ready" && state.refreshError).toBe("net down");
    });
    expect(hook.result.current.isStale).toBe(true);

    vi.mocked(groupsApi.getGroupAccess).mockResolvedValueOnce(access("user"));
    await act(() => hook.result.current.refetch());

    const { state } = hook.result.current;
    expect(hook.result.current.isStale).toBe(false);
    expect(state.status === "ready" && state.refreshError).toBeNull();
    expect(state.status === "ready" && state.data).toEqual(access("user"));
  });

  it("paramsChange_showsLoadingNotPreviousTerm_untilNewResponse", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValueOnce(access("A"));
    const hook = renderHook(({ termId }) => useTermAccess(1, termId), { initialProps: { termId: 2 }, wrapper: createQueryWrapper() });
    await waitFor(() => expect(hook.result.current.state.status).toBe("ready"));
    const pending = deferred<GroupAccessResponse>();
    vi.mocked(groupsApi.getGroupAccess).mockReturnValueOnce(pending.promise);

    hook.rerender({ termId: 3 });

    expect(hook.result.current.state).toEqual({ status: "loading" });
    await act(async () => {
      pending.resolve(access("B"));
      await pending.promise;
    });
    const { state } = hook.result.current;
    expect(state.status === "ready" && state.data).toEqual(access("B"));
  });

  it("paramsChange_fetchFails_givesErrorState_notPreviousTerm", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValueOnce(access("A"));
    const hook = renderHook(({ groupId }) => useTermAccess(groupId, 2), { initialProps: { groupId: 1 }, wrapper: createQueryWrapper() });
    await waitFor(() => expect(hook.result.current.state.status).toBe("ready"));
    vi.mocked(groupsApi.getGroupAccess).mockRejectedValueOnce(new Error("404 Not Found"));

    hook.rerender({ groupId: 9 });

    await waitFor(() => expect(hook.result.current.state).toEqual({ status: "error", message: "404 Not Found" }));
  });
});
