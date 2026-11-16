import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as wantsApi from "../api/wants";
import { useWantMatches } from "../hooks/useWantMatches";
import { makeWant, makeWantMatch } from "./fixtures/wants";
import { createQueryWrapper, createTestQueryClient } from "./queryClient";

let mockAuth: { token: string | null };
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));

vi.mock("../api/wants", () => ({
  getWant: vi.fn(),
  getWantMatches: vi.fn(),
  markWantMatchesSeen: vi.fn(),
  markWantMatchOpened: vi.fn(),
}));

const WANT = makeWant({ match_count: 1, new_match_count: 1 });
const MATCH = makeWantMatch({ is_new: true });

function notFoundError() {
  return new ApiError(404, "Not Found", { status: 404, error: "Not Found", message: "Nie znaleziono poszukiwania." });
}

async function renderLoaded(client = createTestQueryClient()) {
  vi.mocked(wantsApi.getWant).mockResolvedValue(WANT);
  vi.mocked(wantsApi.getWantMatches).mockResolvedValue([MATCH]);
  const hook = renderHook(() => useWantMatches("want-1"), { wrapper: createQueryWrapper(client) });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth = { token: "token-a" };
});

describe("useWantMatches", () => {
  it("loads the want with its matches under the wants prefix, and nothing without a token", async () => {
    mockAuth = { token: null };
    const anonymous = renderHook(() => useWantMatches("want-1"), { wrapper: createQueryWrapper() });
    const firstEmpty = anonymous.result.current.matches;
    anonymous.rerender();
    expect(anonymous.result.current.want).toBeNull();
    expect(anonymous.result.current.matches).toBe(firstEmpty);
    expect(anonymous.result.current.loading).toBe(false);
    expect(wantsApi.getWant).not.toHaveBeenCalled();

    mockAuth = { token: "token-a" };
    const client = createTestQueryClient();
    const { result } = await renderLoaded(client);

    expect(result.current.want).toEqual(WANT);
    expect(result.current.matches).toEqual([MATCH]);
    expect(result.current.notFound).toBe(false);
    expect(result.current.error).toBeNull();
    expect(wantsApi.getWant).toHaveBeenCalledWith("want-1");
    expect(wantsApi.getWantMatches).toHaveBeenCalledWith("want-1");
    expect(client.getQueryData(["wants", "matches", "token-a", "want-1"])).toEqual({ want: WANT, matches: [MATCH] });
  });

  it("flags a 404 as not found instead of an error, and reports other failures as the server's message", async () => {
    vi.mocked(wantsApi.getWant).mockRejectedValue(notFoundError());
    vi.mocked(wantsApi.getWantMatches).mockRejectedValue(notFoundError());
    const missing = renderHook(() => useWantMatches("want-1"), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(missing.result.current.notFound).toBe(true));
    expect(missing.result.current.error).toBeNull();
    expect(missing.result.current.want).toBeNull();

    vi.mocked(wantsApi.getWantMatches).mockResolvedValue([]);
    vi.mocked(wantsApi.getWant).mockRejectedValue(
      new ApiError(503, "Service Unavailable", { status: 503, error: "x", message: "Spróbuj za chwilę." }),
    );
    const failing = renderHook(() => useWantMatches("want-2"), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(failing.result.current.error).toBe("Spróbuj za chwilę."));
    expect(failing.result.current.notFound).toBe(false);
  });

  it("markSeen resolves only after the whole wants prefix is invalidated", async () => {
    vi.mocked(wantsApi.markWantMatchesSeen).mockResolvedValue(makeWant({ match_count: 1 }));
    const client = createTestQueryClient();
    let invalidated = false;
    const invalidate = vi.spyOn(client, "invalidateQueries").mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      invalidated = true;
    });
    const { result } = await renderLoaded(client);

    await act(async () => {
      await result.current.markSeen();
    });

    expect(wantsApi.markWantMatchesSeen).toHaveBeenCalledWith("want-1");
    expect(invalidated).toBe(true);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["wants"] });
  });

  it("markOpened posts the open mark for one item and passes a failure's message through", async () => {
    vi.mocked(wantsApi.markWantMatchOpened).mockResolvedValueOnce(undefined);
    const { result } = await renderLoaded();

    await result.current.markOpened("item-1");
    expect(wantsApi.markWantMatchOpened).toHaveBeenCalledWith("want-1", "item-1");

    vi.mocked(wantsApi.markWantMatchOpened).mockRejectedValueOnce(
      new ApiError(404, "Not Found", { status: 404, error: "Not Found", message: "Nie znaleziono dopasowania." }),
    );
    await expect(result.current.markOpened("item-2")).rejects.toThrow("Nie znaleziono dopasowania.");
  });
});
