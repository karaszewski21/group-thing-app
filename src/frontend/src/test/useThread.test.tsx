import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as conversationsApi from "../api/conversations";
import type { MessageResponse } from "../api/conversations";
import { useAuth } from "../auth/AuthContext";
import { useThread } from "../hooks/useThread";
import { createQueryWrapper, createTestQueryClient } from "./queryClient";

vi.mock("../auth/AuthContext", () => ({ useAuth: vi.fn() }));

vi.mock("../api/conversations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/conversations")>();
  return {
    chatErrorMessage: actual.chatErrorMessage,
    getMessages: vi.fn(),
    postMessage: vi.fn(),
    markConversationRead: vi.fn(),
  };
});

const CONVERSATION_ID = "5b0c6a1e-2f3d-4e5a-8b7c-9d0e1f2a3b4c";

function message(n: number): MessageResponse {
  return {
    id: `m${n}`,
    body: `Wiadomość ${n}`,
    created_at: `2026-10-22T10:00:0${n}`,
    is_mine: false,
    sender_name: "Ola",
    sender_is_organizer: false,
  };
}

function renderThread(options?: { poll?: boolean }) {
  const client = createTestQueryClient();
  const hook = renderHook(() => useThread(CONVERSATION_ID, options), { wrapper: createQueryWrapper(client) });
  return { client, ...hook };
}

/** The poll interval the thread query's observer currently resolves to. */
function pollInterval(client: ReturnType<typeof createTestQueryClient>) {
  const query = client.getQueryCache().find({ queryKey: ["thread", "ala", CONVERSATION_ID] });
  const interval = query?.observers[0]?.options.refetchInterval;
  return typeof interval === "function" && query ? interval(query) : interval;
}

const ids = (items: MessageResponse[]) => items.map((m) => m.id);

describe("useThread", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(useAuth).mockReturnValue({ token: "jwt", username: "ala" } as ReturnType<typeof useAuth>);
  });

  it("firstLoad_fetchesNewestPageWithoutCursor_andPollsEvery5s", async () => {
    vi.mocked(conversationsApi.getMessages).mockResolvedValue({ items: [message(3), message(4)], has_more: true });
    const { client, result } = renderThread();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(conversationsApi.getMessages).toHaveBeenCalledWith(CONVERSATION_ID);
    expect(ids(result.current.items)).toEqual(["m3", "m4"]);
    expect(result.current.hasOlder).toBe(true);

    const query = client.getQueryCache().find({ queryKey: ["thread", "ala", CONVERSATION_ID] });
    expect(query?.observers).toHaveLength(1);
    expect(pollInterval(client)).toBe(5_000);
    expect(query?.observers[0]?.options.refetchIntervalInBackground).toBeFalsy();
  });

  it("poll_fetchesAfterLastId_andAppendsWithoutDuplicates", async () => {
    vi.mocked(conversationsApi.getMessages)
      .mockResolvedValueOnce({ items: [message(3), message(4)], has_more: false })
      .mockResolvedValueOnce({ items: [message(4), message(5)], has_more: false });
    const { result } = renderThread();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.refetch();
    });

    expect(conversationsApi.getMessages).toHaveBeenLastCalledWith(CONVERSATION_ID, { after: "m4" });
    expect(ids(result.current.items)).toEqual(["m3", "m4", "m5"]);
  });

  it("loadOlder_prependsPage_updatesHasOlder_andSurvivesNextPoll", async () => {
    vi.mocked(conversationsApi.getMessages)
      .mockResolvedValueOnce({ items: [message(3), message(4)], has_more: true })
      .mockResolvedValueOnce({ items: [message(1), message(2)], has_more: false })
      .mockResolvedValueOnce({ items: [message(5)], has_more: false });
    const { result } = renderThread();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.loadOlder();
    });
    expect(conversationsApi.getMessages).toHaveBeenLastCalledWith(CONVERSATION_ID, { before: "m3" });
    expect(ids(result.current.items)).toEqual(["m1", "m2", "m3", "m4"]);
    expect(result.current.hasOlder).toBe(false);
    expect(result.current.loadingOlder).toBe(false);

    await act(async () => {
      await result.current.refetch();
    });
    expect(ids(result.current.items)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    expect(result.current.hasOlder).toBe(false);
  });

  it("pollInFlightDuringLoadOlder_keepsOlderPageAndAppendsPolledMessage", async () => {
    let resolvePoll: (page: { items: MessageResponse[]; has_more: boolean }) => void = () => {};
    vi.mocked(conversationsApi.getMessages).mockImplementation((_id, cursor) => {
      if (!cursor) return Promise.resolve({ items: [message(3), message(4)], has_more: true });
      if ("before" in cursor) return Promise.resolve({ items: [message(1), message(2)], has_more: false });
      return new Promise((resolve) => {
        resolvePoll = resolve;
      });
    });
    const { result } = renderThread();
    await waitFor(() => expect(result.current.loading).toBe(false));

    let poll: Promise<void> = Promise.resolve();
    act(() => {
      poll = result.current.refetch();
    });
    await waitFor(() =>
      expect(conversationsApi.getMessages).toHaveBeenLastCalledWith(CONVERSATION_ID, { after: "m4" }),
    );
    await act(async () => {
      await result.current.loadOlder();
    });
    await act(async () => {
      resolvePoll({ items: [message(5)], has_more: false });
      await poll;
    });

    expect(ids(result.current.items)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    expect(result.current.hasOlder).toBe(false);
  });

  it("send_appendsReturnedMessage_andInvalidatesInbox", async () => {
    vi.mocked(conversationsApi.getMessages).mockResolvedValue({ items: [message(1)], has_more: false });
    const mine = { ...message(2), is_mine: true };
    vi.mocked(conversationsApi.postMessage).mockResolvedValue(mine);
    const { client, result } = renderThread();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const invalidate = vi.spyOn(client, "invalidateQueries");

    await act(async () => {
      await result.current.send("Cześć");
    });

    expect(conversationsApi.postMessage).toHaveBeenCalledWith(CONVERSATION_ID, "Cześć");
    expect(ids(result.current.items)).toEqual(["m1", "m2"]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["conversations"] });
  });
  it("crossingMessage_sentBeforeMineButUnpolled_isFetchedByNextPoll", async () => {
    const mine = { ...message(3), is_mine: true };
    vi.mocked(conversationsApi.getMessages).mockImplementation((_id, cursor) => {
      if (!cursor) return Promise.resolve({ items: [message(1)], has_more: false });
      if ("after" in cursor && cursor.after === "m1") return Promise.resolve({ items: [message(2), mine], has_more: false });
      return Promise.resolve({ items: [], has_more: false });
    });
    vi.mocked(conversationsApi.postMessage).mockResolvedValue(mine);
    const { result } = renderThread();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.send("Cześć");
    });
    expect(ids(result.current.items)).toEqual(["m1", "m3"]);

    await act(async () => {
      await result.current.refetch();
    });

    expect(conversationsApi.getMessages).toHaveBeenLastCalledWith(CONVERSATION_ID, { after: "m1" });
    expect(ids(result.current.items)).toEqual(["m1", "m2", "m3"]);
  });

  it("remountAfterSend_resumesPollingFromLastServerFetchedId", async () => {
    const mine = { ...message(3), is_mine: true };
    vi.mocked(conversationsApi.getMessages).mockImplementation((_id, cursor) => {
      if (!cursor) return Promise.resolve({ items: [message(1)], has_more: false });
      if ("after" in cursor && cursor.after === "m1") return Promise.resolve({ items: [message(2), mine], has_more: false });
      return Promise.resolve({ items: [], has_more: false });
    });
    vi.mocked(conversationsApi.postMessage).mockResolvedValue(mine);
    const { client, result, unmount } = renderThread();
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.send("Cześć");
    });
    unmount();

    const again = renderHook(() => useThread(CONVERSATION_ID), { wrapper: createQueryWrapper(client) });

    await waitFor(() => expect(ids(again.result.current.items)).toEqual(["m1", "m2", "m3"]));
    expect(conversationsApi.getMessages).toHaveBeenLastCalledWith(CONVERSATION_ID, { after: "m1" });
  });

  it("firstMessageSentDuringInFlightFirstPoll_isKept", async () => {
    let resolvePoll: (page: { items: MessageResponse[]; has_more: boolean }) => void = () => {};
    vi.mocked(conversationsApi.getMessages)
      .mockResolvedValueOnce({ items: [], has_more: false })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePoll = resolve;
          }),
      );
    const mine = { ...message(1), is_mine: true };
    vi.mocked(conversationsApi.postMessage).mockResolvedValue(mine);
    const { result } = renderThread();
    await waitFor(() => expect(result.current.loading).toBe(false));

    let poll: Promise<void> = Promise.resolve();
    act(() => {
      poll = result.current.refetch();
    });
    await waitFor(() => expect(conversationsApi.getMessages).toHaveBeenCalledTimes(2));
    await act(async () => {
      await result.current.send("Pierwsza");
    });
    await act(async () => {
      resolvePoll({ items: [], has_more: false });
      await poll;
    });

    expect(ids(result.current.items)).toEqual(["m1"]);
  });

  it("poll_withHasMore_keepsFetchingUntilCaughtUp", async () => {
    vi.mocked(conversationsApi.getMessages)
      .mockResolvedValueOnce({ items: [message(1)], has_more: false })
      .mockResolvedValueOnce({ items: [message(2)], has_more: true })
      .mockResolvedValueOnce({ items: [message(3)], has_more: false });
    const { result } = renderThread();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.refetch();
    });

    expect(conversationsApi.getMessages).toHaveBeenNthCalledWith(2, CONVERSATION_ID, { after: "m1" });
    expect(conversationsApi.getMessages).toHaveBeenNthCalledWith(3, CONVERSATION_ID, { after: "m2" });
    expect(ids(result.current.items)).toEqual(["m1", "m2", "m3"]);
  });

  it.each([400, 403, 404])("firstLoadFails%i_stopsPolling", async (status) => {
    vi.mocked(conversationsApi.getMessages).mockRejectedValue(new ApiError(status, "Error", null));
    const { client, result } = renderThread();

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(pollInterval(client)).toBe(false);
  });

  it("serverError_keepsPolling", async () => {
    vi.mocked(conversationsApi.getMessages).mockRejectedValue(new ApiError(503, "Unavailable", null));
    const { client, result } = renderThread();

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(pollInterval(client)).toBe(5_000);
  });

  it("pollFalse_disablesInterval", async () => {
    vi.mocked(conversationsApi.getMessages).mockResolvedValue({ items: [message(1)], has_more: false });
    const { client, result } = renderThread({ poll: false });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(pollInterval(client)).toBe(false);
  });
});
