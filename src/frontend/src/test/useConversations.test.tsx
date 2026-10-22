import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as conversationsApi from "../api/conversations";
import { useAuth } from "../auth/AuthContext";
import { useConversations } from "../hooks/useConversations";
import { createQueryWrapper, createTestQueryClient } from "./queryClient";

vi.mock("../auth/AuthContext", () => ({ useAuth: vi.fn() }));

vi.mock("../api/conversations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/conversations")>();
  return { chatErrorMessage: actual.chatErrorMessage, getConversations: vi.fn() };
});

describe("useConversations", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("loggedIn_pollsEvery20sOnlyInForeground", async () => {
    vi.mocked(useAuth).mockReturnValue({ token: "jwt", username: "ala" } as ReturnType<typeof useAuth>);
    vi.mocked(conversationsApi.getConversations).mockResolvedValue([]);
    const client = createTestQueryClient();
    const { result } = renderHook(() => useConversations(), { wrapper: createQueryWrapper(client) });

    await waitFor(() => expect(result.current.loading).toBe(false));
    const query = client.getQueryCache().find({ queryKey: ["conversations", "ala"] });
    expect(query?.observers[0]?.options.refetchInterval).toBe(20_000);
    expect(query?.observers[0]?.options.refetchIntervalInBackground).toBeFalsy();
  });

  it("loggedOut_doesNotFetch", () => {
    vi.mocked(useAuth).mockReturnValue({ token: null, username: null } as ReturnType<typeof useAuth>);
    renderHook(() => useConversations(), { wrapper: createQueryWrapper() });

    expect(conversationsApi.getConversations).not.toHaveBeenCalled();
  });
});
