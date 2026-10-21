import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as groupsApi from "../api/groups";
import { useJoinCode } from "../hooks/useJoinCode";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/groups", () => ({ getJoinCode: vi.fn(), regenerateJoinCode: vi.fn() }));

describe("useJoinCode", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("status_mapsResolvedDeniedAndError_andIsIdleWhenDisabled", async () => {
    vi.mocked(groupsApi.getJoinCode).mockResolvedValueOnce({ code: "482913" });
    const ready = renderHook(() => useJoinCode("g1", { enabled: true }), { wrapper: createQueryWrapper() });
    expect(ready.result.current.status).toBe("loading");
    await waitFor(() => expect(ready.result.current.status).toBe("ready"));
    expect(ready.result.current.code).toBe("482913");
    expect(groupsApi.getJoinCode).toHaveBeenCalledWith("g1");

    vi.mocked(groupsApi.getJoinCode).mockRejectedValueOnce(new ApiError(403, "Forbidden", { message: "Access denied" }));
    const denied = renderHook(() => useJoinCode("g2", { enabled: true }), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(denied.result.current.status).toBe("denied"));
    expect(denied.result.current.code).toBeNull();

    vi.mocked(groupsApi.getJoinCode).mockRejectedValueOnce(new ApiError(500, "Server Error", null));
    const failed = renderHook(() => useJoinCode("g3", { enabled: true }), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(failed.result.current.status).toBe("error"));

    vi.mocked(groupsApi.getJoinCode).mockClear();
    const disabled = renderHook(() => useJoinCode("g4", { enabled: false }), { wrapper: createQueryWrapper() });
    expect(disabled.result.current.status).toBe("idle");
    await act(async () => {});
    expect(disabled.result.current.status).toBe("idle");
    expect(disabled.result.current.code).toBeNull();
    expect(groupsApi.getJoinCode).not.toHaveBeenCalled();
  });

  it("regenerate_cachesReturnedCodeWithoutRefetch_andRethrowsServerMessageOnConflict", async () => {
    vi.mocked(groupsApi.getJoinCode).mockResolvedValueOnce({ code: "111111" });
    const { result } = renderHook(() => useJoinCode("g1", { enabled: true }), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.code).toBe("111111"));

    vi.mocked(groupsApi.regenerateJoinCode).mockResolvedValueOnce({ code: "222222" });
    await act(() => result.current.regenerate());
    expect(groupsApi.regenerateJoinCode).toHaveBeenCalledWith("g1");
    expect(result.current.code).toBe("222222");
    await act(async () => {});
    expect(groupsApi.getJoinCode).toHaveBeenCalledTimes(1);

    vi.mocked(groupsApi.regenerateJoinCode).mockRejectedValueOnce(
      new ApiError(409, "Conflict", { message: "Grupa jest publiczna — kod dostępu nie jest potrzebny" }),
    );
    let caught: unknown;
    await act(async () => {
      try {
        await result.current.regenerate();
      } catch (err) {
        caught = err;
      }
    });
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("Grupa jest publiczna — kod dostępu nie jest potrzebny");
    expect((caught as Error).message).not.toContain("409");
  });
});
