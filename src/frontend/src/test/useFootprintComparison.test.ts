import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as footprintsApi from "../api/footprints";
import type { FootprintQueryInput, FootprintResponse } from "../api/footprints";
import { useFootprintComparison } from "../hooks/useFootprintComparison";

vi.mock("../api/footprints", () => ({
  getProductFootprint: vi.fn(),
}));

let uuidCounter = 0;
beforeEach(() => {
  uuidCounter = 0;
  vi.stubGlobal("crypto", {
    randomUUID: () => `uuid-${++uuidCounter}`,
  });
});

function buildResponse(total: number, correlationId = "corr"): FootprintResponse {
  return {
    correlationId,
    comparisonGroupId: "group-1",
    computedAt: "2026-05-20T10:00:00Z",
    total,
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
    options: { strictness: "STRICT", normalisation: "TOTAL", dryRun: false },
    breakdown: {
      type: "leaf",
      componentId: "factor:base",
      kgCo2: total,
      scope: 1,
      factorVersionId: "fv-1",
      factorRate: total,
      factorValidFrom: "2026-01-01T00:00:00Z",
      quantity: 1,
      warnings: [],
    },
  };
}

const baselineInput: FootprintQueryInput = { materialWeightKg: 0.2 };

describe("useFootprintComparison", () => {
  beforeEach(() => {
    vi.mocked(footprintsApi.getProductFootprint).mockReset();
  });

  it("fires one fetch on mount with the comparisonGroupId forwarded as header", async () => {
    vi.mocked(footprintsApi.getProductFootprint).mockResolvedValue(buildResponse(1));

    const { result } = renderHook(() =>
      useFootprintComparison("prod-1", "group-1", [baselineInput]),
    );

    await waitFor(() => expect(result.current.scenarios[0].loading).toBe(false));

    const calls = vi.mocked(footprintsApi.getProductFootprint).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("prod-1");
    expect(calls[0][1]).toEqual(baselineInput);
    expect(calls[0][2]).toEqual({ comparisonGroupId: "group-1" });
  });

  it("addScenario appends entry and fires fetch with same comparisonGroupId", async () => {
    vi.mocked(footprintsApi.getProductFootprint).mockResolvedValue(buildResponse(1));

    const { result } = renderHook(() =>
      useFootprintComparison("prod-1", "group-1", [baselineInput]),
    );

    await waitFor(() => expect(result.current.scenarios[0].loading).toBe(false));
    expect(vi.mocked(footprintsApi.getProductFootprint)).toHaveBeenCalledTimes(1);

    const newInput: FootprintQueryInput = { materialWeightKg: 0.5 };
    await act(async () => {
      result.current.addScenario(newInput);
    });

    await waitFor(() => expect(result.current.scenarios).toHaveLength(2));
    await waitFor(() => expect(result.current.scenarios[1].loading).toBe(false));

    const calls = vi.mocked(footprintsApi.getProductFootprint).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1][1]).toEqual(newInput);
    expect(calls[1][2]).toEqual({ comparisonGroupId: "group-1" });
  });

  it("updateScenario re-fires fetch only for that scenario; sibling loading untouched", async () => {
    vi.mocked(footprintsApi.getProductFootprint).mockResolvedValue(buildResponse(1));

    const { result } = renderHook(() =>
      useFootprintComparison("prod-1", "group-1", [
        baselineInput,
        { materialWeightKg: 0.3 },
      ]),
    );

    await waitFor(() => expect(result.current.scenarios[0].loading).toBe(false));
    await waitFor(() => expect(result.current.scenarios[1].loading).toBe(false));
    expect(vi.mocked(footprintsApi.getProductFootprint)).toHaveBeenCalledTimes(2);

    // Make the next fetch hang so we can observe per-scenario loading state.
    let resolveFn!: (v: FootprintResponse) => void;
    vi.mocked(footprintsApi.getProductFootprint).mockReturnValueOnce(
      new Promise<FootprintResponse>((resolve) => {
        resolveFn = resolve;
      }),
    );

    const targetId = result.current.scenarios[1].id;
    const updated: FootprintQueryInput = { materialWeightKg: 0.7 };
    act(() => {
      result.current.updateScenario(targetId, updated);
    });

    expect(result.current.scenarios[1].loading).toBe(true);
    expect(result.current.scenarios[1].input).toEqual(updated);
    expect(result.current.scenarios[0].loading).toBe(false);

    await act(async () => {
      resolveFn(buildResponse(2));
    });
    await waitFor(() => expect(result.current.scenarios[1].loading).toBe(false));

    expect(vi.mocked(footprintsApi.getProductFootprint)).toHaveBeenCalledTimes(3);
    expect(
      vi.mocked(footprintsApi.getProductFootprint).mock.calls[2][1],
    ).toEqual(updated);
  });

  it("removeScenario drops non-baseline; calling with baseline id is a no-op", async () => {
    vi.mocked(footprintsApi.getProductFootprint).mockResolvedValue(buildResponse(1));

    const { result } = renderHook(() =>
      useFootprintComparison("prod-1", "group-1", [
        baselineInput,
        { materialWeightKg: 0.3 },
      ]),
    );

    await waitFor(() => expect(result.current.scenarios[0].loading).toBe(false));
    await waitFor(() => expect(result.current.scenarios[1].loading).toBe(false));

    const baselineId = result.current.scenarios[0].id;
    const secondId = result.current.scenarios[1].id;

    // Attempt to remove baseline — no-op.
    act(() => {
      result.current.removeScenario(baselineId);
    });
    expect(result.current.scenarios).toHaveLength(2);

    // Remove non-baseline.
    act(() => {
      result.current.removeScenario(secondId);
    });
    expect(result.current.scenarios).toHaveLength(1);
    expect(result.current.scenarios[0].id).toBe(baselineId);
  });

  it("per-scenario failure stores error on that scenario; siblings keep data and no error", async () => {
    const problemBody = {
      type: "about:blank",
      title: "Unprocessable Entity",
      status: 422,
      detail: "Material weight must be positive",
    };
    vi.mocked(footprintsApi.getProductFootprint)
      .mockResolvedValueOnce(buildResponse(1, "corr-1"))
      .mockRejectedValueOnce(new ApiError(422, "Unprocessable Entity", problemBody));

    const { result } = renderHook(() =>
      useFootprintComparison("prod-1", "group-1", [
        baselineInput,
        { materialWeightKg: -1 },
      ]),
    );

    await waitFor(() => expect(result.current.scenarios[0].loading).toBe(false));
    await waitFor(() => expect(result.current.scenarios[1].loading).toBe(false));

    expect(result.current.scenarios[0].data).not.toBeNull();
    expect(result.current.scenarios[0].error).toBeNull();
    expect(result.current.scenarios[1].data).toBeNull();
    expect(result.current.scenarios[1].error).toBe("Material weight must be positive");
  });
});
