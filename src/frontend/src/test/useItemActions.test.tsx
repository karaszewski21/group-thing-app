import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as itemActionsApi from "../api/itemActions";
import type { ItemActionsResponse } from "../api/itemActions";
import { useAuth } from "../auth/AuthContext";
import { useItemActions } from "../hooks/useItemActions";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/itemActions", () => ({ getItemActions: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useAuth: vi.fn() }));

const ACTIONS: ItemActionsResponse = {
  mode: "GIFT",
  visibility: null,
  available: true,
  reservation: null,
  party_reservation: null,
  owner: { party_id: "p1", display_name: "Ania", slug: "ania", items_total: 3 },
  viewer: "ANONYMOUS",
  location: null,
  contexts: [],
  personal_pickup_available: false,
};

function mockViewer(username: string | null) {
  vi.mocked(useAuth).mockReturnValue({
    token: username ? `token-${username}` : null,
    username,
    displayName: null,
    permissions: [],
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    expireSession: vi.fn(),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("useItemActions", () => {
  it("fetches the item's actions without a context", async () => {
    mockViewer(null);
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(ACTIONS);

    const { result } = renderHook(() => useItemActions("i1"), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.data).toEqual(ACTIONS));
    expect(itemActionsApi.getItemActions).toHaveBeenCalledWith("i1");
  });

  it("refetches when the viewer logs in, so anonymous data is not reused", async () => {
    mockViewer(null);
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValueOnce(ACTIONS);
    const { result, rerender } = renderHook(() => useItemActions("i1"), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.data?.viewer).toBe("ANONYMOUS"));

    vi.mocked(itemActionsApi.getItemActions).mockResolvedValueOnce({ ...ACTIONS, viewer: "OTHER" });
    mockViewer("u1");
    rerender();

    await waitFor(() => expect(result.current.data?.viewer).toBe("OTHER"));
    expect(itemActionsApi.getItemActions).toHaveBeenCalledTimes(2);
  });
});
