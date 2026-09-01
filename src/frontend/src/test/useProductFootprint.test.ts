import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as footprintsApi from "../api/footprints";
import type { FootprintResponse } from "../api/footprints";
import { useProductFootprint } from "../hooks/useProductFootprint";

vi.mock("../api/footprints", () => ({
  getProductFootprint: vi.fn(),
}));

const mockResponse: FootprintResponse = {
  correlationId: "corr-123",
  comparisonGroupId: null,
  computedAt: "2026-05-20T10:00:00Z",
  total: 1.5,
  unit: "KG_CO2",
  parametersEcho: {
    productId: "prod-1",
    materialWeightKg: 0.2,
    supplierDistanceKm: null,
    destinationDistanceKm: null,
    lastMileDistanceKm: null,
    storageDays: 0,
    requiresRefrigeration: false,
    timestamp: "2026-05-20T10:00:00Z",
  },
  options: {
    strictness: "STRICT",
    normalisation: "TOTAL",
    dryRun: false,
  },
  breakdown: {
    type: "leaf",
    componentId: "factor:base",
    kgCo2: 1.5,
    scope: 1,
    factorVersionId: "fv-1",
    factorRate: 1.5,
    factorValidFrom: "2026-01-01T00:00:00Z",
    quantity: 1,
    warnings: [],
  },
};

describe("useProductFootprint", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("fetches on mount and exposes data, correlationId, loading=false", async () => {
    vi.mocked(footprintsApi.getProductFootprint).mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useProductFootprint("prod-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(mockResponse);
    expect(result.current.correlationId).toBe("corr-123");
    expect(result.current.error).toBeNull();
    expect(footprintsApi.getProductFootprint).toHaveBeenCalledWith("prod-1", undefined);
  });

  it("sets loading=true while the request is pending", async () => {
    let resolveFn!: (value: FootprintResponse) => void;
    vi.mocked(footprintsApi.getProductFootprint).mockReturnValue(
      new Promise<FootprintResponse>((resolve) => {
        resolveFn = resolve;
      }),
    );

    const { result } = renderHook(() => useProductFootprint("prod-1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await act(async () => {
      resolveFn(mockResponse);
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(mockResponse);
  });

  it("pipes ApiError through extractProblemMessage on rejection", async () => {
    const problemBody = {
      type: "about:blank",
      title: "Unprocessable Entity",
      status: 422,
      detail: "Material weight must be positive",
    };
    vi.mocked(footprintsApi.getProductFootprint).mockRejectedValue(
      new ApiError(422, "Unprocessable Entity", problemBody),
    );

    const { result } = renderHook(() => useProductFootprint("prod-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Material weight must be positive");
    expect(result.current.data).toBeNull();
    expect(result.current.correlationId).toBeNull();
  });

  it("refetch() re-invokes getProductFootprint with the same args", async () => {
    vi.mocked(footprintsApi.getProductFootprint).mockResolvedValue(mockResponse);
    const query = { materialWeightKg: 0.5 };

    const { result } = renderHook(() => useProductFootprint("prod-1", query));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(footprintsApi.getProductFootprint).toHaveBeenCalledTimes(1);
    expect(footprintsApi.getProductFootprint).toHaveBeenLastCalledWith("prod-1", query);

    await act(async () => {
      await result.current.refetch();
    });

    expect(footprintsApi.getProductFootprint).toHaveBeenCalledTimes(2);
    expect(footprintsApi.getProductFootprint).toHaveBeenLastCalledWith("prod-1", query);
  });
});
