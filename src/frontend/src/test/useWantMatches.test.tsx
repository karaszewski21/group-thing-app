import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as wantsApi from "../api/wants";
import { useWantMatches } from "../hooks/useWantMatches";
import { makeWant, makeWantMatch, makeWantSimilar, makeWantSuggestion } from "./fixtures/wants";
import { createQueryWrapper, createTestQueryClient } from "./queryClient";

type TestClient = ReturnType<typeof createTestQueryClient>;

let mockAuth: { token: string | null };
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));

vi.mock("../api/wants", () => ({
  getWant: vi.fn(),
  getWantMatches: vi.fn(),
  getWantSuggestions: vi.fn(),
  getWantSimilar: vi.fn(),
  markWantMatchesSeen: vi.fn(),
  markWantMatchOpened: vi.fn(),
}));

const WANT = makeWant({ match_count: 1, new_match_count: 1 });
const MATCH = makeWantMatch({ is_new: true });
const SUGGESTION = makeWantSuggestion();
const SIMILAR = makeWantSimilar();
const MATCHING_WANT = makeWant({ matching: true });

function notFoundError() {
  return new ApiError(404, "Not Found", { status: 404, error: "Not Found", message: "Nie znaleziono poszukiwania." });
}

async function renderLoaded(client = createTestQueryClient()) {
  vi.mocked(wantsApi.getWant).mockResolvedValue(WANT);
  vi.mocked(wantsApi.getWantMatches).mockResolvedValue([MATCH]);
  vi.mocked(wantsApi.getWantSuggestions).mockResolvedValue([SUGGESTION]);
  vi.mocked(wantsApi.getWantSimilar).mockResolvedValue([SIMILAR]);
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
  it("loads the want with its matches, suggestions and related items under the wants prefix, and nothing without a token", async () => {
    mockAuth = { token: null };
    const anonymous = renderHook(() => useWantMatches("want-1"), { wrapper: createQueryWrapper() });
    const firstEmpty = anonymous.result.current.matches;
    const firstNoSuggestions = anonymous.result.current.suggestions;
    const firstNoSimilar = anonymous.result.current.similar;
    anonymous.rerender();
    expect(anonymous.result.current.want).toBeNull();
    expect(anonymous.result.current.matches).toBe(firstEmpty);
    expect(anonymous.result.current.suggestions).toBe(firstNoSuggestions);
    expect(anonymous.result.current.suggestions).toEqual([]);
    expect(anonymous.result.current.similar).toBe(firstNoSimilar);
    expect(anonymous.result.current.similar).toEqual([]);
    expect(anonymous.result.current.loading).toBe(false);
    expect(wantsApi.getWant).not.toHaveBeenCalled();

    mockAuth = { token: "token-a" };
    const client = createTestQueryClient();
    const { result } = await renderLoaded(client);

    expect(result.current.want).toEqual(WANT);
    expect(result.current.matches).toEqual([MATCH]);
    expect(result.current.suggestions).toEqual([SUGGESTION]);
    expect(result.current.similar).toEqual([SIMILAR]);
    expect(result.current.slow).toBe(false);
    expect(result.current.notFound).toBe(false);
    expect(result.current.error).toBeNull();
    expect(wantsApi.getWant).toHaveBeenCalledWith("want-1");
    expect(wantsApi.getWantMatches).toHaveBeenCalledWith("want-1");
    expect(wantsApi.getWantSuggestions).toHaveBeenCalledWith("want-1");
    expect(wantsApi.getWantSimilar).toHaveBeenCalledWith("want-1");
    expect(client.getQueryData(["wants", "matches", "token-a", "want-1"])).toEqual({
      want: WANT,
      matches: [MATCH],
      suggestions: [SUGGESTION],
      similar: [SIMILAR],
    });
  });

  it("flags a 404 as not found instead of an error, and reports other failures as the server's message", async () => {
    vi.mocked(wantsApi.getWant).mockRejectedValue(notFoundError());
    vi.mocked(wantsApi.getWantMatches).mockRejectedValue(notFoundError());
    vi.mocked(wantsApi.getWantSuggestions).mockRejectedValue(notFoundError());
    vi.mocked(wantsApi.getWantSimilar).mockRejectedValue(notFoundError());
    const missing = renderHook(() => useWantMatches("want-1"), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(missing.result.current.notFound).toBe(true));
    expect(missing.result.current.error).toBeNull();
    expect(missing.result.current.want).toBeNull();

    vi.mocked(wantsApi.getWantMatches).mockResolvedValue([]);
    vi.mocked(wantsApi.getWantSuggestions).mockResolvedValue([]);
    vi.mocked(wantsApi.getWantSimilar).mockResolvedValue([]);
    vi.mocked(wantsApi.getWant).mockRejectedValue(
      new ApiError(503, "Service Unavailable", { status: 503, error: "x", message: "Spróbuj za chwilę." }),
    );
    const failing = renderHook(() => useWantMatches("want-2"), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(failing.result.current.error).toBe("Spróbuj za chwilę."));
    expect(failing.result.current.notFound).toBe(false);
  });

  it.each([
    ["a 500", new ApiError(500, "Internal Server Error", { status: 500, error: "x", message: "Błąd serwera." })],
    ["a 404 (older backend)", notFoundError()],
  ])("keeps the want, matches and suggestions when /similar alone fails with %s", async (_label, failure) => {
    vi.mocked(wantsApi.getWant).mockResolvedValue(WANT);
    vi.mocked(wantsApi.getWantMatches).mockResolvedValue([MATCH]);
    vi.mocked(wantsApi.getWantSuggestions).mockResolvedValue([SUGGESTION]);
    vi.mocked(wantsApi.getWantSimilar).mockRejectedValue(failure);
    const { result, rerender } = renderHook(() => useWantMatches("want-1"), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.want).toEqual(WANT);
    expect(result.current.matches).toEqual([MATCH]);
    expect(result.current.suggestions).toEqual([SUGGESTION]);
    expect(result.current.similar).toEqual([]);
    expect(result.current.notFound).toBe(false);
    expect(result.current.error).toBeNull();
    const firstSimilar = result.current.similar;
    rerender();
    expect(result.current.similar).toBe(firstSimilar);
  });

  it("keeps the related items of the last read when /similar fails on a refetch, and updates the rest", async () => {
    const OTHER_SIMILAR = makeWantSimilar({ id: "item-13", title: "Rowerek trójkołowy" });
    vi.mocked(wantsApi.getWant).mockResolvedValue(WANT);
    vi.mocked(wantsApi.getWantMatches).mockResolvedValue([MATCH]);
    vi.mocked(wantsApi.getWantSuggestions).mockResolvedValue([SUGGESTION]);
    vi.mocked(wantsApi.getWantSimilar).mockResolvedValue([SIMILAR, OTHER_SIMILAR]);
    const { result } = renderHook(() => useWantMatches("want-1"), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.similar).toHaveLength(2));

    const UPDATED_WANT = makeWant({ match_count: 2, new_match_count: 2 });
    const NEW_MATCH = makeWantMatch({ id: "item-2", is_new: true });
    const NEW_SUGGESTION = makeWantSuggestion({ id: "item-8" });
    vi.mocked(wantsApi.getWant).mockResolvedValue(UPDATED_WANT);
    vi.mocked(wantsApi.getWantMatches).mockResolvedValue([MATCH, NEW_MATCH]);
    vi.mocked(wantsApi.getWantSuggestions).mockResolvedValue([NEW_SUGGESTION]);
    vi.mocked(wantsApi.getWantSimilar).mockRejectedValue(
      new ApiError(500, "Internal Server Error", { status: 500, error: "x", message: "Błąd serwera." }),
    );
    await act(async () => {
      await result.current.refetch();
    });

    expect(wantsApi.getWantSimilar).toHaveBeenCalledTimes(2);
    expect(result.current.want).toEqual(UPDATED_WANT);
    expect(result.current.matches).toEqual([MATCH, NEW_MATCH]);
    expect(result.current.suggestions).toEqual([NEW_SUGGESTION]);
    expect(result.current.similar).toEqual([SIMILAR, OTHER_SIMILAR]);
    expect(result.current.error).toBeNull();
    expect(result.current.notFound).toBe(false);
  });

  it("still reports not found when the want itself is missing and /similar answers", async () => {
    vi.mocked(wantsApi.getWant).mockRejectedValue(notFoundError());
    vi.mocked(wantsApi.getWantMatches).mockResolvedValue([]);
    vi.mocked(wantsApi.getWantSuggestions).mockResolvedValue([]);
    vi.mocked(wantsApi.getWantSimilar).mockResolvedValue([SIMILAR]);
    const { result } = renderHook(() => useWantMatches("want-1"), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.notFound).toBe(true));
    expect(result.current.want).toBeNull();
    expect(result.current.similar).toEqual([]);
    expect(result.current.error).toBeNull();
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
    vi.mocked(wantsApi.getWantSimilar).mockResolvedValue([]);
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
      vi.mocked(wantsApi.getWantSimilar).mockResolvedValue([]);
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
