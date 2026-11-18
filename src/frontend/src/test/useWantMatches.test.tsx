import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as wantsApi from "../api/wants";
import { useWantMatches } from "../hooks/useWantMatches";
import { makeWant, makeWantMatch, makeWantSuggestion } from "./fixtures/wants";
import { createQueryWrapper, createTestQueryClient } from "./queryClient";

type TestClient = ReturnType<typeof createTestQueryClient>;

let mockAuth: { token: string | null };
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));

vi.mock("../api/wants", () => ({
  getWant: vi.fn(),
  getWantMatches: vi.fn(),
  getWantSuggestions: vi.fn(),
  markWantMatchesSeen: vi.fn(),
  markWantMatchOpened: vi.fn(),
}));

const WANT = makeWant({ match_count: 1, new_match_count: 1 });
const MATCH = makeWantMatch({ is_new: true });
const SUGGESTION = makeWantSuggestion();
const MATCHING_WANT = makeWant({ matching: true });

function notFoundError() {
  return new ApiError(404, "Not Found", { status: 404, error: "Not Found", message: "Nie znaleziono poszukiwania." });
}

async function renderLoaded(client = createTestQueryClient()) {
  vi.mocked(wantsApi.getWant).mockResolvedValue(WANT);
  vi.mocked(wantsApi.getWantMatches).mockResolvedValue([MATCH]);
  vi.mocked(wantsApi.getWantSuggestions).mockResolvedValue([SUGGESTION]);
  const hook = renderHook(() => useWantMatches("want-1"), { wrapper: createQueryWrapper(client) });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

/** The interval TanStack would use next, read from the live query's
 * observer options (no 2 s wall-clock wait), as in `useItemDetail.test.tsx`. */
function nextInterval(client: TestClient) {
  const query = client.getQueryCache().find({ queryKey: ["wants", "matches", "token-a", "want-1"] });
  const option = query?.observers[0]?.options.refetchInterval;
  return typeof option === "function" ? option(query!) : option;
}

/** Lets the mocked fetches resolve without `waitFor`, whose own timeout runs
 * on the faked `setTimeout`. */
async function flushFetches() {
  await act(async () => {});
}

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth = { token: "token-a" };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useWantMatches", () => {
  it("loads the want with its matches and suggestions under the wants prefix, and nothing without a token", async () => {
    mockAuth = { token: null };
    const anonymous = renderHook(() => useWantMatches("want-1"), { wrapper: createQueryWrapper() });
    const firstEmpty = anonymous.result.current.matches;
    const firstNoSuggestions = anonymous.result.current.suggestions;
    anonymous.rerender();
    expect(anonymous.result.current.want).toBeNull();
    expect(anonymous.result.current.matches).toBe(firstEmpty);
    expect(anonymous.result.current.suggestions).toBe(firstNoSuggestions);
    expect(anonymous.result.current.suggestions).toEqual([]);
    expect(anonymous.result.current.loading).toBe(false);
    expect(wantsApi.getWant).not.toHaveBeenCalled();

    mockAuth = { token: "token-a" };
    const client = createTestQueryClient();
    const { result } = await renderLoaded(client);

    expect(result.current.want).toEqual(WANT);
    expect(result.current.matches).toEqual([MATCH]);
    expect(result.current.suggestions).toEqual([SUGGESTION]);
    expect(result.current.slow).toBe(false);
    expect(result.current.notFound).toBe(false);
    expect(result.current.error).toBeNull();
    expect(wantsApi.getWant).toHaveBeenCalledWith("want-1");
    expect(wantsApi.getWantMatches).toHaveBeenCalledWith("want-1");
    expect(wantsApi.getWantSuggestions).toHaveBeenCalledWith("want-1");
    expect(client.getQueryData(["wants", "matches", "token-a", "want-1"])).toEqual({
      want: WANT,
      matches: [MATCH],
      suggestions: [SUGGESTION],
    });
  });

  it("flags a 404 as not found instead of an error, and reports other failures as the server's message", async () => {
    vi.mocked(wantsApi.getWant).mockRejectedValue(notFoundError());
    vi.mocked(wantsApi.getWantMatches).mockRejectedValue(notFoundError());
    vi.mocked(wantsApi.getWantSuggestions).mockRejectedValue(notFoundError());
    const missing = renderHook(() => useWantMatches("want-1"), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(missing.result.current.notFound).toBe(true));
    expect(missing.result.current.error).toBeNull();
    expect(missing.result.current.want).toBeNull();

    vi.mocked(wantsApi.getWantMatches).mockResolvedValue([]);
    vi.mocked(wantsApi.getWantSuggestions).mockResolvedValue([]);
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

  it("polls every 2 s while the want is matching, and not once it is answered", async () => {
    vi.mocked(wantsApi.getWant).mockResolvedValueOnce(MATCHING_WANT).mockResolvedValue(WANT);
    vi.mocked(wantsApi.getWantMatches).mockResolvedValue([]);
    vi.mocked(wantsApi.getWantSuggestions).mockResolvedValue([]);
    const client = createTestQueryClient();
    const { result } = renderHook(() => useWantMatches("want-1"), { wrapper: createQueryWrapper(client) });
    await waitFor(() => expect(result.current.want?.matching).toBe(true));
    expect(nextInterval(client)).toBe(2000);

    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.want?.matching).toBe(false);
    expect(nextInterval(client)).toBe(false);
  });

  // Documented exception to the Date-only fake-timer rule: the 60 s window
  // end is a `setTimeout`, so these tests fake it (and `clearTimeout`) and
  // step it with `act(() => vi.advanceTimersByTime(…))`. No `findBy*` or
  // `waitFor`: their timeout would run on the faked clock.
  describe("polling window", () => {
    async function renderMatching(client: TestClient) {
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      vi.mocked(wantsApi.getWant).mockResolvedValue(MATCHING_WANT);
      vi.mocked(wantsApi.getWantMatches).mockResolvedValue([MATCH]);
      vi.mocked(wantsApi.getWantSuggestions).mockResolvedValue([]);
      const hook = renderHook(() => useWantMatches("want-1"), { wrapper: createQueryWrapper(client) });
      await flushFetches();
      expect(hook.result.current.want).toEqual(MATCHING_WANT);
      return hook;
    }

    it("turns slow and stops polling after 60 s of matching, without any new data", async () => {
      const client = createTestQueryClient();
      const { result } = await renderMatching(client);
      expect(result.current.slow).toBe(false);

      act(() => vi.advanceTimersByTime(59_999));
      expect(result.current.slow).toBe(false);
      expect(nextInterval(client)).toBe(2000);

      act(() => vi.advanceTimersByTime(1));
      expect(result.current.slow).toBe(true);
      expect(result.current.matches).toEqual([MATCH]);
      expect(nextInterval(client)).toBe(false);
      expect(wantsApi.getWant).toHaveBeenCalledTimes(1);
    });

    it("refetch reads the want again and restarts the window", async () => {
      const client = createTestQueryClient();
      const { result } = await renderMatching(client);
      act(() => vi.advanceTimersByTime(60_000));
      expect(result.current.slow).toBe(true);

      await act(async () => {
        await result.current.refetch();
      });
      expect(wantsApi.getWant).toHaveBeenCalledTimes(2);
      expect(result.current.slow).toBe(false);
      expect(nextInterval(client)).toBe(2000);

      act(() => vi.advanceTimersByTime(59_999));
      expect(result.current.slow).toBe(false);
      act(() => vi.advanceTimersByTime(1));
      expect(result.current.slow).toBe(true);
    });
  });
});
