import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import {
  getFootprintCsvExport,
  getProductFootprint,
  tagBreakdown,
  type BreakdownDto,
  type FootprintResponse,
} from "../api/footprints";

vi.mock("../api/client", () => ({
  api: {
    get: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    statusText: string;
    body: unknown;
    constructor(status: number, statusText: string, body: unknown) {
      super(`${status} ${statusText}`);
      this.status = status;
      this.statusText = statusText;
      this.body = body;
    }
  },
}));

describe("footprint api", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("tagBreakdown tags a leaf-only node with type: 'leaf'", () => {
    const leaf = {
      componentId: "factor:packaging",
      kgCo2: 0.5,
      scope: 2 as const,
      factorVersionId: "fv-1",
      factorRate: 0.1,
      factorValidFrom: "2026-01-01T00:00:00Z",
      quantity: 5,
      warnings: [],
    };
    const tagged = tagBreakdown(leaf as unknown as BreakdownDto);
    expect(tagged.type).toBe("leaf");
    // Idempotent — second call does not break anything.
    const reTagged = tagBreakdown(tagged);
    expect(reTagged.type).toBe("leaf");
  });

  it("tagBreakdown tags composite with type 'composite' and recurses into every nested child", () => {
    const tree = {
      componentId: "root",
      kgCo2: 10,
      warnings: [],
      children: [
        {
          componentId: "branch",
          kgCo2: 4,
          warnings: [],
          children: [
            {
              componentId: "leaf-a",
              kgCo2: 2,
              scope: 1,
              factorVersionId: "fv-a",
              factorRate: 1,
              factorValidFrom: "2026-01-01T00:00:00Z",
              quantity: 2,
              warnings: [],
            },
          ],
        },
        {
          componentId: "leaf-b",
          kgCo2: 6,
          scope: 3,
          factorVersionId: "fv-b",
          factorRate: 2,
          factorValidFrom: "2026-01-01T00:00:00Z",
          quantity: 3,
          warnings: [],
        },
      ],
    };
    const tagged = tagBreakdown(tree as unknown as BreakdownDto);
    expect(tagged.type).toBe("composite");
    if (tagged.type !== "composite") throw new Error("unreachable");
    expect(tagged.children[0].type).toBe("composite");
    expect(tagged.children[1].type).toBe("leaf");
    const innerBranch = tagged.children[0];
    if (innerBranch.type !== "composite") throw new Error("unreachable");
    expect(innerBranch.children[0].type).toBe("leaf");

    // Idempotency: re-tagging does not change the tag or duplicate work.
    const reTagged = tagBreakdown(tagged);
    expect(reTagged.type).toBe("composite");
    if (reTagged.type !== "composite") throw new Error("unreachable");
    expect(reTagged.children[1].type).toBe("leaf");
  });

  it("getProductFootprint calls api.get with resolved query string and forwards X-Comparison-Group header", async () => {
    const response: FootprintResponse = {
      correlationId: "corr-1",
      comparisonGroupId: "grp-1",
      computedAt: "2026-05-20T10:00:00Z",
      total: 1.5,
      unit: "KG_CO2",
      parametersEcho: {
        productId: "p-1",
        materialWeightKg: 1,
        supplierDistanceKm: null,
        destinationDistanceKm: null,
        lastMileDistanceKm: null,
        storageDays: 0,
        requiresRefrigeration: false,
        timestamp: "2026-05-20T10:00:00Z",
      },
      options: { strictness: "STRICT", normalisation: "TOTAL", dryRun: false },
      breakdown: {
        componentId: "root",
        kgCo2: 1.5,
        warnings: [],
        children: [],
      } as unknown as BreakdownDto,
    };
    vi.mocked(api.get).mockResolvedValue(response);

    const result = await getProductFootprint(
      "p-1",
      { materialWeightKg: 1, requiresRefrigeration: false, unit: "TOTAL" },
      { comparisonGroupId: "grp-1" },
    );

    expect(api.get).toHaveBeenCalledTimes(1);
    const [path, _body, opts] = vi.mocked(api.get).mock.calls[0];
    expect(path).toMatch(/^\/products\/p-1\/footprint\?/);
    expect(path).toContain("materialWeightKg=1");
    expect(path).toContain("requiresRefrigeration=false");
    expect(path).toContain("unit=TOTAL");
    expect(opts).toEqual({ headers: { "X-Comparison-Group": "grp-1" } });
    // Caller-supplied Authorization is never forwarded.
    // (The Bearer-wins strip happens inside client.ts; here we assert the API
    //  module does not even put Authorization into headers in the first place.)
    expect(opts?.headers?.Authorization).toBeUndefined();
    // breakdown was tagged
    expect(result.breakdown.type).toBe("composite");
  });

  it("tagBreakdown is idempotent on a pre-tagged composite — children retain their tags and structure", () => {
    // Second pass over an already-tagged composite must not strip or re-tag
    // children incorrectly, and must not throw on nested 'leaf' entries that
    // already have a discriminator.
    const taggedInput = {
      type: "composite" as const,
      componentId: "root",
      kgCo2: 5,
      warnings: [],
      children: [
        {
          type: "leaf" as const,
          componentId: "leaf-x",
          kgCo2: 2,
          scope: 1 as const,
          factorVersionId: "fv-x",
          factorRate: 1,
          factorValidFrom: "2026-01-01T00:00:00Z",
          quantity: 2,
          warnings: [],
        },
      ],
    };
    const out = tagBreakdown(taggedInput as unknown as BreakdownDto);
    expect(out.type).toBe("composite");
    if (out.type !== "composite") throw new Error("unreachable");
    expect(out.children).toHaveLength(1);
    expect(out.children[0].type).toBe("leaf");
    if (out.children[0].type !== "leaf") throw new Error("unreachable");
    expect(out.children[0].componentId).toBe("leaf-x");
    expect(out.children[0].scope).toBe(1);
  });

  it("getFootprintCsvExport fetches CSV and resolves to a Blob", async () => {
    const blob = new Blob(["a,b\n1,2"], { type: "text/csv" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      blob: () => Promise.resolve(blob),
    });
    vi.stubGlobal("fetch", fetchMock);
    const getItemSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockReturnValue("test-token");

    const result = await getFootprintCsvExport("corr-123");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/footprints/calculations/corr-123/export?format=csv");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer test-token",
    });
    expect(result).toBeInstanceOf(Blob);

    getItemSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});
