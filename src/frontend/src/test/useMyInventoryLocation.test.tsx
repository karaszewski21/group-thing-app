import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as inventoriesApi from "../api/inventories";
import type { LocationRefResponse } from "../api/locations";
import { useAuth } from "../auth/AuthContext";
import { ITEM_ACTIONS_KEY } from "../hooks/useItemActions";
import { MY_INVENTORY_LOCATION_KEY, useMyInventoryLocation } from "../hooks/useMyInventoryLocation";
import { createQueryWrapper, createTestQueryClient } from "./queryClient";

vi.mock("../api/inventories", () => ({ getMyInventoryLocation: vi.fn(), setMyInventoryLocation: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useAuth: vi.fn() }));

const PLACE: LocationRefResponse = {
  id: "l1",
  name: "Dom",
  formatted_address: "ul. Lipowa 1, Kraków",
  google_place_id: null,
  notes: null,
  deleted_at: null,
};

function mockViewer(username: string | null) {
  vi.mocked(useAuth).mockReturnValue({
    token: username ? "token" : null,
    username,
    displayName: null,
    permissions: [],
    registeredRole: null,
    login: vi.fn(),
    register: vi.fn(),
    applyExternalToken: vi.fn(),
    logout: vi.fn(),
    expireSession: vi.fn(),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mockViewer("u1");
});

describe("useMyInventoryLocation", () => {
  it("returns the inventory's place", async () => {
    vi.mocked(inventoriesApi.getMyInventoryLocation).mockResolvedValue({ location: PLACE });

    const { result } = renderHook(() => useMyInventoryLocation(), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(PLACE);
    expect(result.current.error).toBeNull();
  });

  it("set saves the place and awaits invalidation of its prefix and item-actions", async () => {
    vi.mocked(inventoriesApi.getMyInventoryLocation).mockResolvedValue({ location: null });
    vi.mocked(inventoriesApi.setMyInventoryLocation).mockResolvedValue({ location: PLACE });
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useMyInventoryLocation(), { wrapper: createQueryWrapper(client) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();

    await act(() => result.current.set("l1"));

    expect(inventoriesApi.setMyInventoryLocation).toHaveBeenCalledWith({ location_id: "l1" });
    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toEqual(expect.arrayContaining([[MY_INVENTORY_LOCATION_KEY], [ITEM_ACTIONS_KEY]]));
  });

  it("a signed-out viewer is not loading and fetches nothing", () => {
    mockViewer(null);

    const { result } = renderHook(() => useMyInventoryLocation(), { wrapper: createQueryWrapper() });

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(inventoriesApi.getMyInventoryLocation).not.toHaveBeenCalled();
  });
});
