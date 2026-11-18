import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../api/client";
import * as wantsApi from "../api/wants";
import type { WantResponse } from "../api/wants";
import { useWants, WantWriteError } from "../hooks/useWants";
import { useWantsMatchingItem } from "../hooks/useWantsMatchingItem";
import { makeWant } from "./fixtures/wants";
import { createQueryWrapper, createTestQueryClient } from "./queryClient";

let mockAuth: { token: string | null };
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));

vi.mock("../api/wants", () => ({
  getMyWants: vi.fn(),
  createWant: vi.fn(),
  updateWant: vi.fn(),
  extendWant: vi.fn(),
  closeWant: vi.fn(),
  resumeWant: vi.fn(),
}));

const WANT = makeWant();
const CAP_MESSAGE = "Masz już 30 aktywnych poszukiwań. Zamknij któreś, aby dodać nowe.";

type Wants = ReturnType<typeof useWants>;

/** A client whose invalidation takes a moment, to prove the mutation waits for it. */
function slowInvalidatingClient() {
  const client = createTestQueryClient();
  const state = { invalidated: false };
  const invalidate = vi.spyOn(client, "invalidateQueries").mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    state.invalidated = true;
  });
  return { client, state, invalidate };
}

async function renderLoaded(client = createTestQueryClient()) {
  vi.mocked(wantsApi.getMyWants).mockResolvedValue([WANT]);
  const hook = renderHook(() => useWants(), { wrapper: createQueryWrapper(client) });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth = { token: "token-a" };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useWants", () => {
  it("stays disabled without a token with a stable empty list, and keys the list by token", async () => {
    mockAuth = { token: null };
    const anonymous = renderHook(() => useWants(), { wrapper: createQueryWrapper() });
    const firstEmpty = anonymous.result.current.data;
    anonymous.rerender();
    expect(anonymous.result.current.data).toEqual([]);
    expect(anonymous.result.current.data).toBe(firstEmpty);
    expect(anonymous.result.current.loading).toBe(false);
    expect(wantsApi.getMyWants).not.toHaveBeenCalled();

    mockAuth = { token: "token-a" };
    const client = createTestQueryClient();
    const { result } = await renderLoaded(client);

    expect(result.current.data).toEqual([WANT]);
    expect(result.current.error).toBeNull();
    expect(wantsApi.getMyWants).toHaveBeenCalledWith();
    expect(client.getQueryData(["wants", "mine", "token-a"])).toEqual([WANT]);
  });

  const MUTATIONS: {
    name: string;
    apiFn: "createWant" | "updateWant" | "extendWant" | "closeWant" | "resumeWant";
    call: (wants: Wants) => Promise<WantResponse>;
    args: unknown[];
  }[] = [
    { name: "create", apiFn: "createWant", call: (w) => w.create({ name: "Kask" }), args: [{ name: "Kask" }] },
    {
      name: "update",
      apiFn: "updateWant",
      call: (w) => w.update("want-1", { notifications_enabled: false }),
      args: ["want-1", { notifications_enabled: false }],
    },
    { name: "extend", apiFn: "extendWant", call: (w) => w.extend("want-1"), args: ["want-1"] },
    {
      name: "close",
      apiFn: "closeWant",
      call: (w) => w.close("want-1", "FULFILLED"),
      args: ["want-1", "FULFILLED"],
    },
    { name: "resume", apiFn: "resumeWant", call: (w) => w.resume("want-1"), args: ["want-1"] },
  ];

  it.each(MUTATIONS)("$name returns the want only after the whole wants prefix is invalidated", async (mutation) => {
    const saved = makeWant({ id: "want-1", name: "Kask" });
    vi.mocked(wantsApi[mutation.apiFn]).mockResolvedValue(saved);
    const { client, state, invalidate } = slowInvalidatingClient();
    const { result } = await renderLoaded(client);

    let returned: WantResponse | undefined;
    await act(async () => {
      returned = await mutation.call(result.current);
    });

    expect(wantsApi[mutation.apiFn]).toHaveBeenCalledWith(...mutation.args);
    expect(returned).toEqual(saved);
    expect(state.invalidated).toBe(true);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["wants"] });
  });

  it.each(MUTATIONS)("$name passes the server's message through and invalidates nothing", async (mutation) => {
    vi.mocked(wantsApi[mutation.apiFn]).mockRejectedValue(
      new ApiError(409, "Conflict", { status: 409, error: "Conflict", message: CAP_MESSAGE }),
    );
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = await renderLoaded(client);

    await expect(mutation.call(result.current)).rejects.toThrow(CAP_MESSAGE);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("a failed write keeps the HTTP status, and none without a response", async () => {
    vi.mocked(wantsApi.createWant).mockRejectedValueOnce(
      new ApiError(409, "Conflict", { status: 409, error: "Conflict", message: CAP_MESSAGE }),
    );
    vi.mocked(wantsApi.updateWant).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { result } = await renderLoaded();

    const capped = await result.current.create({ name: "Kask" }).catch((err: unknown) => err);
    expect(capped).toBeInstanceOf(WantWriteError);
    expect(capped).toMatchObject({ message: CAP_MESSAGE, status: 409 });

    const offline = await result.current.update("want-1", { note: null }).catch((err: unknown) => err);
    expect(offline).toBeInstanceOf(WantWriteError);
    expect(offline).toMatchObject({
      message: "Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.",
      status: null,
    });
  });
});

describe("useWants matching polling", () => {
  function nextInterval(client: ReturnType<typeof createTestQueryClient>) {
    const query = client.getQueryCache().find({ queryKey: ["wants", "mine", "token-a"] });
    const option = query?.observers[0]?.options.refetchInterval;
    return typeof option === "function" ? option(query!) : option;
  }

  it("does not poll a list with no want matching", async () => {
    const client = createTestQueryClient();
    await renderLoaded(client);
    expect(nextInterval(client)).toBe(false);
  });

  // Documented exception to the Date-only fake-timer rule: the 60 s window
  // end is a `setTimeout`, so it is faked too and stepped inside `act`;
  // no `waitFor`/`findBy*`, whose timeout would run on the faked clock.
  it("polls every 2 s while any listed want is matching, and stops after the 60 s window", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.mocked(wantsApi.getMyWants).mockResolvedValue([makeWant({ id: "want-2" }), makeWant({ matching: true })]);
    const client = createTestQueryClient();
    const { result } = renderHook(() => useWants(), { wrapper: createQueryWrapper(client) });
    await act(async () => {});
    expect(result.current.data).toHaveLength(2);
    expect(nextInterval(client)).toBe(2000);

    act(() => vi.advanceTimersByTime(60_000));
    expect(nextInterval(client)).toBe(false);
    expect(result.current.data[1].matching).toBe(true);
  });

  // Same documented timer exception as above.
  it("after a run-out window and the matcher's answer, a want matching again opens a new window", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.mocked(wantsApi.getMyWants).mockResolvedValue([makeWant({ matching: true })]);
    const client = createTestQueryClient();
    const { result } = renderHook(() => useWants(), { wrapper: createQueryWrapper(client) });
    await act(async () => {});
    act(() => vi.advanceTimersByTime(60_000));
    expect(nextInterval(client)).toBe(false);

    vi.mocked(wantsApi.getMyWants).mockResolvedValue([makeWant()]);
    await act(() => result.current.refetch());
    expect(nextInterval(client)).toBe(false);

    vi.mocked(wantsApi.getMyWants).mockResolvedValue([makeWant(), makeWant({ id: "want-2", matching: true })]);
    await act(() => result.current.refetch());
    act(() => vi.advanceTimersByTime(59_000));
    expect(nextInterval(client)).toBe(2000);

    act(() => vi.advanceTimersByTime(1_000));
    expect(nextInterval(client)).toBe(false);
  });
});

describe("useWantsMatchingItem", () => {
  it("stays idle without an item or a token, so the lookup runs only once asked for", async () => {
    const idle = renderHook(() => useWantsMatchingItem(null), { wrapper: createQueryWrapper() });
    mockAuth = { token: null };
    const guest = renderHook(() => useWantsMatchingItem("item-9"), { wrapper: createQueryWrapper() });

    expect(idle.result.current.data).toEqual([]);
    expect(guest.result.current.data).toEqual([]);
    expect(wantsApi.getMyWants).not.toHaveBeenCalled();
  });

  it("asks for the active wants holding the item, keyed under the wants prefix by token and item", async () => {
    const matching = [makeWant({ id: "want-2", name: "Fotelik" })];
    vi.mocked(wantsApi.getMyWants).mockResolvedValue(matching);
    const client = createTestQueryClient();
    const { result } = renderHook(() => useWantsMatchingItem("item-9"), { wrapper: createQueryWrapper(client) });

    await waitFor(() => expect(result.current.data).toEqual(matching));
    expect(wantsApi.getMyWants).toHaveBeenCalledWith("item-9");
    expect(client.getQueryData(["wants", "matching", "token-a", "item-9"])).toEqual(matching);
  });
});

describe("wants API module", () => {
  it("the API module sends each request to its route", async () => {
    const actual = await vi.importActual<typeof import("../api/wants")>("../api/wants");
    const get = vi.spyOn(api, "get").mockResolvedValue([]);
    const post = vi.spyOn(api, "post").mockResolvedValue(WANT);
    const patch = vi.spyOn(api, "patch").mockResolvedValue(WANT);

    await actual.getMyWants();
    await actual.getMyWants("item-9");
    await actual.getWant("want-1");
    await actual.getWantMatches("want-1");
    await actual.getWantSuggestions("want-1");
    await actual.createWant({ name: "Kask" });
    await actual.updateWant("want-1", { note: null });
    await actual.extendWant("want-1");
    await actual.closeWant("want-1", "WITHDRAWN");
    await actual.resumeWant("want-1");
    await actual.markWantMatchesSeen("want-1");
    await actual.markWantMatchOpened("want-1", "item-9");

    expect(get.mock.calls.map(([path]) => path)).toEqual([
      "/wants",
      "/wants?matched_item_id=item-9",
      "/wants/want-1",
      "/wants/want-1/matches",
      "/wants/want-1/suggestions",
    ]);
    expect(patch).toHaveBeenCalledWith("/wants/want-1", { note: null });
    expect(post.mock.calls).toEqual([
      ["/wants", { name: "Kask" }],
      ["/wants/want-1/extend", undefined],
      ["/wants/want-1/close", { outcome: "WITHDRAWN" }],
      ["/wants/want-1/resume", undefined],
      ["/wants/want-1/matches/seen", undefined],
      ["/wants/want-1/matches/item-9/opened", undefined],
    ]);
    get.mockRestore();
    post.mockRestore();
    patch.mockRestore();
  });
});
