import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as conversationsApi from "../api/conversations";
import { useAuth } from "../auth/AuthContext";
import { useUnreadMessages } from "../hooks/useUnreadMessages";
import { createQueryWrapper, createTestQueryClient } from "./queryClient";

vi.mock("../auth/AuthContext", () => ({ useAuth: vi.fn() }));

vi.mock("../api/conversations", () => ({ getUnreadMessageCount: vi.fn() }));

function mockAuth(token: string | null, username: string | null) {
  vi.mocked(useAuth).mockReturnValue({ token, username } as ReturnType<typeof useAuth>);
}

describe("useUnreadMessages", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("loggedIn_pollsEvery20sOnlyInForeground", async () => {
    mockAuth("jwt", "ala");
    vi.mocked(conversationsApi.getUnreadMessageCount).mockResolvedValue({ count: 12 });
    const client = createTestQueryClient();
    const { result } = renderHook(() => useUnreadMessages(), { wrapper: createQueryWrapper(client) });

    await waitFor(() => expect(result.current.count).toBe(12));
    const query = client.getQueryCache().find({ queryKey: ["unreadMessages", "ala"] });
    expect(query?.observers[0]?.options.refetchInterval).toBe(20_000);
    expect(query?.observers[0]?.options.refetchIntervalInBackground).toBeFalsy();
  });

  it("loggedOut_doesNotFetch", () => {
    mockAuth(null, null);
    const { result } = renderHook(() => useUnreadMessages(), { wrapper: createQueryWrapper() });

    expect(result.current.count).toBe(0);
    expect(conversationsApi.getUnreadMessageCount).not.toHaveBeenCalled();
  });
});
