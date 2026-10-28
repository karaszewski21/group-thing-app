import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as conversationsApi from "../api/conversations";
import { ApiError } from "../api/client";
import type { ConversationResponse } from "../api/conversations";
import { useOpenAndNavigate } from "../hooks/useOpenAndNavigate";
import { useOpenConversation } from "../hooks/useOpenConversation";
import { createQueryWrapper, createTestQueryClient } from "./queryClient";

vi.mock("../api/conversations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/conversations")>();
  return {
    chatErrorMessage: actual.chatErrorMessage,
    getOrCreateItemConversation: vi.fn(),
    getOrCreateGroupConversation: vi.fn(),
    getOrCreateTermConversation: vi.fn(),
  };
});

const conversation = (id: string) => ({ id }) as ConversationResponse;

function routerWrapper() {
  const QueryWrapper = createQueryWrapper();
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryWrapper>
        <MemoryRouter initialEntries={["/start"]}>
          <Routes>
            <Route path="*" element={children} />
          </Routes>
        </MemoryRouter>
      </QueryWrapper>
    );
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
    const { result } = renderHook(() => ({ chat: useOpenAndNavigate(), location: useLocation() }), {
      wrapper: routerWrapper(),
    });

    await act(() => result.current.chat.open({ kind: "TERM", id: "t1" }));

    expect(result.current.location.pathname).toBe("/messages/c7");
    expect(result.current.chat).toMatchObject({ busy: false, error: null });
  });

  it("open_failure_keepsThePageAndExposesTheError", async () => {
    vi.mocked(conversationsApi.getOrCreateItemConversation).mockRejectedValue(new ApiError(404, "Not Found", null));
    const { result } = renderHook(() => ({ chat: useOpenAndNavigate(), location: useLocation() }), {
      wrapper: routerWrapper(),
    });

    await act(() => result.current.chat.open({ kind: "ITEM", id: "i1" }));

    await waitFor(() => expect(result.current.chat.error).toBe("Nie znaleziono — mogło zostać usunięte."));
    expect(result.current.chat.busy).toBe(false);
    expect(result.current.location.pathname).toBe("/start");
  });
});
