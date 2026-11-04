import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../api/client";
import * as locationsApi from "../api/locations";
import type { LocationResponse } from "../api/locations";
import { useMyLocations } from "../hooks/useMyLocations";
import { makeLocality, makeLocationResponse } from "./fixtures/locations";
import { createQueryWrapper, createTestQueryClient } from "./queryClient";

let mockAuth: { token: string | null };
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));

vi.mock("../api/locations", () => ({
  getMyLocations: vi.fn(),
  createLocation: vi.fn(),
  updateLocation: vi.fn(),
  deleteLocation: vi.fn(),
}));

const GOOGLE_LOCATION = makeLocationResponse({
  label: "Kęty — Polna 12, 32-650 Kęty",
  formatted_address: "Polna 12, 32-650 Kęty",
  google_place_id: "ChIJ-test",
  lat: 49.88,
  lng: 19.22,
  source: "GOOGLE",
});

const LOCALITY_ONLY = makeLocationResponse({ id: "loc-2" });

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth = { token: "token-a" };
});

describe("useMyLocations", () => {
  it("returns the app shape with a stable empty fallback and keys the list by token", async () => {
    mockAuth = { token: null };
    const anonymous = renderHook(() => useMyLocations(), { wrapper: createQueryWrapper() });
    const firstEmpty = anonymous.result.current.data;
    anonymous.rerender();
    expect(anonymous.result.current.data).toEqual([]);
    expect(anonymous.result.current.data).toBe(firstEmpty);
    expect(locationsApi.getMyLocations).not.toHaveBeenCalled();

    mockAuth = { token: "token-a" };
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([GOOGLE_LOCATION]);
    const client = createTestQueryClient();
    const { result } = renderHook(() => useMyLocations(), { wrapper: createQueryWrapper(client) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual([GOOGLE_LOCATION]);
    expect(result.current.error).toBeNull();
    expect(typeof result.current.refetch).toBe("function");
    expect(typeof result.current.create).toBe("function");
    expect(typeof result.current.update).toBe("function");
    expect(typeof result.current.remove).toBe("function");
    expect(client.getQueryData(["locations", "mine", "token-a"])).toEqual([GOOGLE_LOCATION]);
  });

  it("create always sends the request, even for an already saved place id, and awaits invalidation", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([GOOGLE_LOCATION]);
    const second = makeLocationResponse({ ...GOOGLE_LOCATION, id: "loc-3" });
    vi.mocked(locationsApi.createLocation).mockResolvedValue(second);
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useMyLocations(), { wrapper: createQueryWrapper(client) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const request = {
      locality_id: GOOGLE_LOCATION.locality.id,
      formatted_address: "Polna 12, 32-650 Kęty",
      source: "GOOGLE" as const,
      google_place_id: "ChIJ-test",
      lat: 49.88,
      lng: 19.22,
    };
    let created: LocationResponse | undefined;
    await act(async () => {
      created = await result.current.create(request);
    });
    expect(created).toEqual(second);
    expect(locationsApi.createLocation).toHaveBeenCalledWith(request);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["locations"] });
  });

  it("update sends the full body through PUT and resolves only after the locations prefix is invalidated", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([LOCALITY_ONLY]);
    const moved = makeLocationResponse({
      id: "loc-2",
      locality: makeLocality({ id: "0045012", name: "Nowa Wieś", kind: "VILLAGE" }),
      label: "Nowa Wieś, małopolskie",
    });
    vi.mocked(locationsApi.updateLocation).mockResolvedValue(moved);
    const client = createTestQueryClient();
    let invalidated = false;
    vi.spyOn(client, "invalidateQueries").mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      invalidated = true;
    });
    const { result } = renderHook(() => useMyLocations(), { wrapper: createQueryWrapper(client) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let updated: LocationResponse | undefined;
    await act(async () => {
      updated = await result.current.update("loc-2", { locality_id: "0045012" });
    });
    expect(locationsApi.updateLocation).toHaveBeenCalledWith("loc-2", { locality_id: "0045012" });
    expect(updated).toEqual(moved);
    expect(invalidated).toBe(true);
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["locations"] });
  });

  it("the API module replaces a place with PUT", async () => {
    const actual = await vi.importActual<typeof import("../api/locations")>("../api/locations");
    const put = vi.spyOn(api, "put").mockResolvedValue(LOCALITY_ONLY);
    const patch = vi.spyOn(api, "patch");

    await actual.updateLocation("loc 2", { locality_id: "0937730" });

    expect(put).toHaveBeenCalledWith("/locations/loc%202", { locality_id: "0937730" });
    expect(patch).not.toHaveBeenCalled();
    put.mockRestore();
    patch.mockRestore();
  });

  it("remove rethrows the backend's problem message and invalidates after success", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([LOCALITY_ONLY]);
    vi.mocked(locationsApi.deleteLocation).mockRejectedValueOnce(
      new ApiError(403, "Forbidden", { status: 403, title: "Forbidden", detail: "To nie Twoje miejsce" }),
    );
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useMyLocations(), { wrapper: createQueryWrapper(client) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.remove("loc-2")).rejects.toThrow("To nie Twoje miejsce");
    expect(invalidate).not.toHaveBeenCalled();

    vi.mocked(locationsApi.deleteLocation).mockResolvedValueOnce(undefined);
    await act(async () => {
      await result.current.remove("loc-2");
    });
    expect(locationsApi.deleteLocation).toHaveBeenLastCalledWith("loc-2");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["locations"] });
  });
});
