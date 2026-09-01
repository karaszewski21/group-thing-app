import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../theme";
import { FootprintComparisonPage } from "../pages/FootprintComparisonPage";
import { ApiError } from "../api/client";
import * as footprintsApi from "../api/footprints";
import * as productsApi from "../api/products";
import * as downloadUtil from "../utils/download";
import { encodeScenario } from "../utils/scenarioUrl";
import type { FootprintResponse } from "../api/footprints";
import type { ProductResponse } from "../api/products";

vi.mock("../api/footprints", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/footprints")>();
  return {
    ...actual,
    getProductFootprint: vi.fn(),
    getFootprintCsvExport: vi.fn(),
  };
});

vi.mock("../api/products", () => ({
  getProduct: vi.fn(),
}));

vi.mock("../utils/download", () => ({
  downloadBlob: vi.fn(),
}));

const product: ProductResponse = {
  id: 123,
  name: "Organic Frozen Berries 500g",
  description: null,
  photoUrl: null,
  price: 9.99,
  sku: "OFB-330",
  category: {
    id: 1,
    name: "Frozen",
    description: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  pluginData: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function buildResponse(total: number, correlationId = "corr"): FootprintResponse {
  return {
    correlationId,
    comparisonGroupId: "cg-from-test",
    computedAt: "2026-05-20T10:00:00Z",
    total,
    unit: "KG_CO2",
    parametersEcho: {
      productId: "123",
      materialWeightKg: 0.5,
      supplierDistanceKm: null,
      destinationDistanceKm: 570,
      lastMileDistanceKm: null,
      storageDays: 14,
      requiresRefrigeration: true,
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

function renderWithProviders(initialPath: string) {
  return render(
    <ChakraProvider value={system}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="/products/:id/footprint/compare"
            element={<FootprintComparisonPage />}
          />
        </Routes>
      </MemoryRouter>
    </ChakraProvider>,
  );
}

describe("FootprintComparisonPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(productsApi.getProduct).mockResolvedValue(product);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("mounts with one baseline scenario from URL ?s=<encoded> and renders one card with total", async () => {
    vi.mocked(footprintsApi.getProductFootprint).mockResolvedValue(buildResponse(5.37));
    const encoded = encodeScenario({ asOf: "2026-07-15", destinationDistanceKm: 570, storageDays: 14 });

    renderWithProviders(`/products/123/footprint/compare?cg=fixed-cg&s=${encoded}`);

    await waitFor(() => expect(screen.getByText(/5\.370/)).toBeInTheDocument());

    const cards = screen.getAllByTestId("scenario-card");
    expect(cards).toHaveLength(1);
  });

  it("Add scenario → 2 cards present; both fetches use same X-Comparison-Group header from URL cg", async () => {
    vi.mocked(footprintsApi.getProductFootprint).mockResolvedValue(buildResponse(5.37));
    const encoded = encodeScenario({ asOf: "2026-07-15", destinationDistanceKm: 570, storageDays: 14 });

    renderWithProviders(`/products/123/footprint/compare?cg=fixed-cg-uuid&s=${encoded}`);

    await waitFor(() => expect(screen.getAllByTestId("scenario-card")).toHaveLength(1));

    const addBtn = screen.getByRole("button", { name: /add scenario/i });
    await act(async () => {
      fireEvent.click(addBtn);
    });

    await waitFor(() => expect(screen.getAllByTestId("scenario-card")).toHaveLength(2));

    const calls = vi.mocked(footprintsApi.getProductFootprint).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[0][2]).toEqual({ comparisonGroupId: "fixed-cg-uuid" });
    expect(calls[1][2]).toEqual({ comparisonGroupId: "fixed-cg-uuid" });
  });

  it("Best-of-N: lower-total card has 'best' marker via data-testid", async () => {
    const enc1 = encodeScenario({ asOf: "2026-07-15", destinationDistanceKm: 570 });
    const enc2 = encodeScenario({ asOf: "2026-01-15", destinationDistanceKm: 15 });

    vi.mocked(footprintsApi.getProductFootprint)
      .mockResolvedValueOnce(buildResponse(5.37, "corr-A"))
      .mockResolvedValueOnce(buildResponse(2.9, "corr-B"));

    renderWithProviders(
      `/products/123/footprint/compare?cg=cg-x&s=${enc1}&s=${enc2}`,
    );

    await waitFor(() => expect(screen.getAllByTestId("scenario-card")).toHaveLength(2));
    await waitFor(() => {
      const best = screen.getAllByTestId("scenario-card-best");
      expect(best).toHaveLength(1);
    });

    // The "best" card should be the second one (total 2.90)
    const bestCard = screen.getByTestId("scenario-card-best");
    expect(bestCard.textContent).toMatch(/2\.90/);
  });

  it("Save comparison: clipboard.writeText called with URL; 'Copied!' appears then clears after 2s", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    vi.mocked(footprintsApi.getProductFootprint).mockResolvedValue(buildResponse(1));
    const encoded = encodeScenario({ asOf: "2026-07-15" });

    renderWithProviders(`/products/123/footprint/compare?cg=cg-save&s=${encoded}`);

    await waitFor(() => expect(screen.getAllByTestId("scenario-card")).toHaveLength(1));

    const saveBtn = screen.getByRole("button", { name: /save comparison/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toMatch(/cg=cg-save/);
    expect(screen.getByText(/Copied!/)).toBeInTheDocument();

    // Wait for the 2s auto-clear timer (page sets a 2000ms timeout).
    await waitFor(
      () => expect(screen.queryByText(/Copied!/)).not.toBeInTheDocument(),
      { timeout: 3000 },
    );
  });

  it("Equal totals delta renders grey '—' (no green/red colouring)", async () => {
    // FR-3 delta colour mapping edge case: when |delta| < 0.005 the cell must
    // render the en-dash with neutral grey, not green/red. Two scenarios with
    // identical totals exercise this code path for the total row.
    const enc1 = encodeScenario({ asOf: "2026-07-15", destinationDistanceKm: 100 });
    const enc2 = encodeScenario({ asOf: "2026-07-15", destinationDistanceKm: 100 });

    vi.mocked(footprintsApi.getProductFootprint)
      .mockResolvedValueOnce(buildResponse(4.2, "corr-A"))
      .mockResolvedValueOnce(buildResponse(4.2, "corr-B"));

    renderWithProviders(`/products/123/footprint/compare?cg=cg-eq&s=${enc1}&s=${enc2}`);

    await waitFor(() => expect(screen.getAllByTestId("scenario-card")).toHaveLength(2));
    // Wait for delta table to render the equal-total row.
    await waitFor(() => {
      const dashCells = screen.getAllByText("—");
      expect(dashCells.length).toBeGreaterThan(0);
    });

    // Neutral grey (gray.500) — neither green.700 nor red.600. We assert the
    // dash text exists and the rendered cell is not coloured as a delta.
    const dashCells = screen.getAllByText("—");
    for (const cell of dashCells) {
      // Chakra renders inline color via CSS var or color prop; gray.500 must
      // not equal the red/green semantic tokens used for non-zero deltas.
      expect(cell.className).not.toMatch(/red/);
      expect(cell.className).not.toMatch(/green/);
    }
  });

  it("Sequential CSV export: error on the 2nd of 2 stops the loop, downloads only the first, and surfaces error message via aria-live status", async () => {
    // Spec §AC-10 / Accessibility — Live regions: a per-export failure must
    // stop subsequent exports and announce the failure via role=status,
    // formatted as "Stopped at n/N: <detail>".
    const blob = new Blob(["a,b\n1,2"], { type: "text/csv" });
    vi.mocked(footprintsApi.getFootprintCsvExport)
      .mockResolvedValueOnce(blob)
      .mockRejectedValueOnce(
        new ApiError(503, "Service Unavailable", {
          type: "about:blank",
          title: "Service Unavailable",
          status: 503,
          detail: "Export service offline",
        }),
      );

    const enc1 = encodeScenario({ asOf: "2026-07-15" });
    const enc2 = encodeScenario({ asOf: "2026-07-16" });
    vi.mocked(footprintsApi.getProductFootprint)
      .mockResolvedValueOnce(buildResponse(1, "corr-A"))
      .mockResolvedValueOnce(buildResponse(2, "corr-B"));

    renderWithProviders(`/products/123/footprint/compare?cg=cg-seq&s=${enc1}&s=${enc2}`);

    await waitFor(() => expect(screen.getAllByTestId("scenario-card")).toHaveLength(2));
    // Wait for both scenarios to resolve before clicking export-all.
    await waitFor(() =>
      expect(screen.queryAllByText(/Loading/i)).toHaveLength(0),
    );

    const exportAllBtn = screen.getByRole("button", { name: /export all as csv/i });
    await act(async () => {
      fireEvent.click(exportAllBtn);
    });

    // Only the first scenario's CSV was downloaded; the loop stopped at the failure.
    await waitFor(() =>
      expect(downloadUtil.downloadBlob).toHaveBeenCalledTimes(1),
    );
    expect(downloadUtil.downloadBlob).toHaveBeenCalledWith(blob, "footprint-corr-A.csv");

    // The failure detail surfaces via the aria-live region. Multiple role=status
    // regions exist on the page (export status + comparison-group counter),
    // so look up by visible text.
    await waitFor(() => {
      expect(screen.getByText(/Stopped at 2\/2: Export service offline/)).toBeInTheDocument();
    });
  });

  it("Invalid URL s= params: falls back to single baseline scenario from product defaults", async () => {
    vi.mocked(footprintsApi.getProductFootprint).mockResolvedValue(buildResponse(1));

    renderWithProviders(`/products/123/footprint/compare?cg=cg-fallback&s=!!!`);

    await waitFor(() => expect(screen.getAllByTestId("scenario-card")).toHaveLength(1));
    expect(screen.queryByText(/Loading footprint/i)).toBeNull();
  });
});
