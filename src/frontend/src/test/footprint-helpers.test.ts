import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../api/client";
import { extractProblemMessage, isProblemDetail } from "../api/problem";
import { downloadBlob } from "../utils/download";
import { formatCO2eKg, formatPer100g } from "../utils/format";
import { decodeScenario, encodeScenario, type ScenarioInput } from "../utils/scenarioUrl";

describe("footprint helpers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("isProblemDetail recognises Problem+JSON bodies and rejects non-objects", () => {
    expect(
      isProblemDetail({ detail: "oops", title: "Bad Request", status: 400 }),
    ).toBe(true);
    expect(isProblemDetail("not an object")).toBe(false);
    expect(isProblemDetail(null)).toBe(false);
    expect(isProblemDetail({ detail: "only detail" })).toBe(false);
  });

  it("extractProblemMessage resolves Problem+JSON, ApiError fallback, and network error", () => {
    const problem = new ApiError(400, "Bad Request", {
      detail: "Material weight required",
      title: "Validation failed",
      status: 400,
    });
    expect(extractProblemMessage(problem)).toBe("Material weight required");

    const plain = new ApiError(500, "Internal Server Error", "boom");
    expect(extractProblemMessage(plain)).toBe("Internal Server Error (HTTP 500)");

    expect(extractProblemMessage(new Error("offline"))).toBe(
      "Network error — check connection",
    );
  });

  it("downloadBlob creates a download anchor and revokes the object URL", () => {
    const createObjectURL = vi.fn(() => "blob:fake");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });

    const clickSpy = vi.fn();
    const originalCreate = document.createElement.bind(document);
    const createSpy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreate(tag);
      if (tag === "a") {
        el.click = clickSpy;
      }
      return el;
    });

    const blob = new Blob(["data"], { type: "text/csv" });
    downloadBlob(blob, "report.csv");

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake");
    createSpy.mockRestore();
  });

  it("encodeScenario/decodeScenario round-trip preserves all fields", () => {
    const input: ScenarioInput = {
      asOf: "2026-05-20",
      materialWeightKg: 1.25,
      supplierDistanceKm: 100,
      destinationDistanceKm: 200,
      lastMileDistanceKm: 15,
      storageDays: 7,
      requiresRefrigeration: true,
      unit: "PER_100G",
    };
    const encoded = encodeScenario(input);
    expect(decodeScenario(encoded)).toEqual(input);
  });

  it("decodeScenario returns null for malformed strings (no throw)", () => {
    expect(decodeScenario("!!!not-base64!!!")).toBeNull();
    expect(decodeScenario(btoa("not json at all"))).toBeNull();
  });

  it("formatCO2eKg and formatPer100g render with 3 decimals and correct suffixes", () => {
    expect(formatCO2eKg(1.2345)).toBe("1.235 kg CO₂");
    expect(formatPer100g(0.5)).toBe("0.500 kg CO₂ / 100g");
  });

  it("isProblemDetail rejects when status is non-numeric or missing required fields", () => {
    // Defensive validation: spec contract requires { detail: string, title: string,
    // status: number }. A non-numeric status must be rejected so that
    // extractProblemMessage falls back to the generic ApiError path.
    expect(
      isProblemDetail({ detail: "x", title: "y", status: "400" }),
    ).toBe(false);
    expect(isProblemDetail({ detail: "x", status: 400 })).toBe(false); // missing title
    expect(isProblemDetail(undefined)).toBe(false);
  });
});

describe("api client — Authorization-collision guard", () => {
  // The Bearer token from localStorage must always win on collision. Any
  // caller-supplied Authorization header must be stripped before merging,
  // otherwise a stale or hostile header would defeat the central auth path.
  let fetchMock: ReturnType<typeof vi.fn>;
  let getItemSpy: ReturnType<typeof vi.spyOn<Storage, "getItem">>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => Promise.resolve({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
    getItemSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockReturnValue("session-token");
  });

  afterEach(() => {
    getItemSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("strips caller-supplied Authorization (any casing) and applies Bearer from localStorage", async () => {
    await api.get("/footprints/anything", undefined, {
      headers: {
        Authorization: "Bearer attacker-supplied",
        "X-Comparison-Group": "cg-1",
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer session-token");
    expect(headers["X-Comparison-Group"]).toBe("cg-1");

    // Lower-case "authorization" must also be stripped before the merge.
    fetchMock.mockClear();
    await api.post("/footprints/anything", { a: 1 }, {
      headers: { authorization: "Bearer evil" },
    });
    const [, init2] = fetchMock.mock.calls[0];
    const headers2 = (init2 as RequestInit).headers as Record<string, string>;
    expect(headers2.Authorization).toBe("Bearer session-token");
    // The lower-case alias was filtered out.
    expect(headers2.authorization).toBeUndefined();
  });
});
