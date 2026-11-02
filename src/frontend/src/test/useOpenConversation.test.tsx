import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as conversationsApi from "../api/conversations";
import { ApiError } from "../api/client";
import type { ConversationResponse } from "../api/conversations";
import { useOpenAndNavigate } from "../hooks/useOpenAndNavigate";
import { useOpenConversation } from "../hooks/useOpenConversation";
import { createQueryWrapper, createTestQueryClient } from "./queryClient";
import { getTestLocation, routeWrapper } from "./renderWithRoute";

vi.mock("../api/conversations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/conversations")>();
  return {
    chatErrorMessage: actual.chatErrorMessage,
    getOrCreateItemConversation: vi.fn(),
    getOrCreateGroupConversation: vi.fn(),
    getOrCreateTermConversation: vi.fn(),
    getOrCreateEventConversation: vi.fn(),
  };
});

const conversation = (id: string) => ({ id }) as ConversationResponse;

type OpenAndNavigate = ReturnType<typeof useOpenAndNavigate>;

/** Renders `useOpenAndNavigate` on a page at `/start`; `chat` is its latest value. */
function renderOpenAndNavigate(): { readonly chat: OpenAndNavigate } {
  const { result } = renderHook(() => useOpenAndNavigate(), {
    wrapper: routeWrapper({ url: "/start", wrapper: createQueryWrapper() }),
  });
  return {
    get chat() {
      return result.current;
    },
  };
}

describe("useOpenConversation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it.each([
    ["ITEM", "getOrCreateItemConversation"],
    ["GROUP", "getOrCreateGroupConversation"],
    ["TERM", "getOrCreateTermConversation"],
    ["EVENT", "getOrCreateEventConversation"],
  ] as const)("open_%s_callsItsGetOrCreateAndInvalidatesTheInbox", async (kind, fn) => {
    vi.mocked(conversationsApi[fn]).mockResolvedValue(conversation("c1"));
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useOpenConversation(), { wrapper: createQueryWrapper(client) });

    await expect(result.current.openConversation({ kind, id: "x1" })).resolves.toBe("c1");
    expect(conversationsApi[fn]).toHaveBeenCalledWith("x1");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["conversations"] });
  });

  it("open_failure_rejectsWithPolishCopy", async () => {
    vi.mocked(conversationsApi.getOrCreateGroupConversation).mockRejectedValue(new ApiError(403, "Forbidden", null));
    const { result } = renderHook(() => useOpenConversation(), { wrapper: createQueryWrapper() });

    await expect(result.current.openConversation({ kind: "GROUP", id: "g1" })).rejects.toThrow(
      "Nie masz dostępu do tego czatu.",
    );
  });
});

describe("useOpenAndNavigate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("open_success_navigatesToTheThread", async () => {
    vi.mocked(conversationsApi.getOrCreateTermConversation).mockResolvedValue(conversation("c7"));
    const result = renderOpenAndNavigate();

    await act(() => result.chat.open({ kind: "TERM", id: "t1" }));

    expect(getTestLocation().pathname).toBe("/messages/c7");
    expect(result.chat).toMatchObject({ busy: false, error: null });
  });

  it("open_failure_keepsThePageAndExposesTheError", async () => {
    vi.mocked(conversationsApi.getOrCreateItemConversation).mockRejectedValue(new ApiError(404, "Not Found", null));
    const result = renderOpenAndNavigate();

    await act(() => result.chat.open({ kind: "ITEM", id: "i1" }));

    await waitFor(() => expect(result.chat.error).toBe("Nie znaleziono — mogło zostać usunięte."));
    expect(result.chat.busy).toBe(false);
    expect(getTestLocation().pathname).toBe("/start");
  });
});
