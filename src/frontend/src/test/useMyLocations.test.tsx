import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as locationsApi from "../api/locations";
import type { LocationResponse } from "../api/locations";
import { useMyLocations } from "../hooks/useMyLocations";
import { createQueryWrapper, createTestQueryClient } from "./queryClient";

let mockAuth: { token: string | null };
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));

vi.mock("../api/locations", () => ({
  getMyLocations: vi.fn(),
  createLocation: vi.fn(),
  updateLocation: vi.fn(),
  deleteLocation: vi.fn(),
}));

const GOOGLE_LOCATION: LocationResponse = {
  id: "loc-1",
  owner_party_id: "party-1",
  name: "Świetlica Osiedlowa",
  formatted_address: "Polna 12, 60-595 Poznań",
  google_place_id: "ChIJ-test",
  lat: 52.4064,
  lng: 16.9252,
  notes: null,
  source: "GOOGLE",
  created_at: "2026-10-01T10:00:00",
  updated_at: "2026-10-01T10:00:00",
  deleted_at: null,
};

const MANUAL_LOCATION: LocationResponse = {
  ...GOOGLE_LOCATION,
  id: "loc-2",
  name: "Sala w bibliotece",
  formatted_address: "Długa 3, Poznań",
  google_place_id: null,
  lat: null,
  lng: null,
  source: "MANUAL",
};

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

  it("create invalidates the locations prefix and reuses an active row with the same place id", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([GOOGLE_LOCATION]);
    vi.mocked(locationsApi.createLocation).mockResolvedValue(MANUAL_LOCATION);
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useMyLocations(), { wrapper: createQueryWrapper(client) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let existing: LocationResponse | undefined;
    await act(async () => {
      existing = await result.current.create({
        name: "Inna nazwa",
        formatted_address: "Polna 12, 60-595 Poznań",
        source: "GOOGLE",
        google_place_id: "ChIJ-test",
        lat: 52.4064,
        lng: 16.9252,
      });
    });
    expect(existing).toEqual(GOOGLE_LOCATION);
    expect(locationsApi.createLocation).not.toHaveBeenCalled();

    let created: LocationResponse | undefined;
    await act(async () => {
      created = await result.current.create({
        name: "Sala w bibliotece",
        formatted_address: "Długa 3, Poznań",
        source: "MANUAL",
      });
    });
    expect(created).toEqual(MANUAL_LOCATION);
    expect(locationsApi.createLocation).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["locations"] });
  });

  it("remove rethrows the backend's problem message and invalidates after success", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([MANUAL_LOCATION]);
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
