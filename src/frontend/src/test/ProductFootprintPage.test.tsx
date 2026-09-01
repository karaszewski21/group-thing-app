import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../theme";
import { ProductFootprintPage } from "../pages/ProductFootprintPage";
import { ApiError } from "../api/client";
import * as footprintsApi from "../api/footprints";
import * as productsApi from "../api/products";
import * as downloadUtil from "../utils/download";
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

function renderWithProviders(initialPath = "/products/123/footprint") {
  return render(
    <ChakraProvider value={system}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/products/:id/footprint" element={<ProductFootprintPage />} />
        </Routes>
      </MemoryRouter>
    </ChakraProvider>,
  );
}

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

const footprintResponse: FootprintResponse = {
  correlationId: "corr-abc-123",
  comparisonGroupId: null,
  computedAt: "2026-05-20T14:32:11Z",
  total: 5.37,
  unit: "KG_CO2",
  parametersEcho: {
    productId: "123",
    materialWeightKg: 0.5,
    supplierDistanceKm: 2800,
    destinationDistanceKm: 570,
    lastMileDistanceKm: null,
    storageDays: 0,
    requiresRefrigeration: true,
    timestamp: "2026-05-20T14:32:11Z",
  },
  options: {
    strictness: "STRICT",
    normalisation: "TOTAL",
    dryRun: false,
  },
  breakdown: {
    type: "composite",
    componentId: "root",
    kgCo2: 5.37,
    warnings: [],
    children: [
      {
        type: "composite",
        componentId: "Materials",
        kgCo2: 1.35,
        warnings: [],
        children: [
          {
            type: "leaf",
            componentId: "raw-material",
            kgCo2: 0.45,
            scope: 3,
            factorVersionId: "fv-raw",
            factorRate: 0.9,
            factorValidFrom: "2026-01-01",
            quantity: 0.5,
            warnings: [],
          },
        ],
      },
      {
        type: "composite",
        componentId: "Transport",
        kgCo2: 1.88,
        warnings: [],
        children: [],
      },
      {
        type: "composite",
        componentId: "Packaging",
        kgCo2: 0.42,
        warnings: [],
        children: [],
      },
      {
        type: "composite",
        componentId: "Cold storage",
        kgCo2: 1.72,
        warnings: [],
        children: [],
      },
    ],
  },
};

describe("ProductFootprintPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("happy path: shows total, 4 top-level bar labels, and breakdown rows", async () => {
    vi.mocked(productsApi.getProduct).mockResolvedValue(product);
    vi.mocked(footprintsApi.getProductFootprint).mockResolvedValue(footprintResponse);

    renderWithProviders();

    await waitFor(() => expect(screen.getByText(/5\.370/)).toBeInTheDocument());

    // 4 top-level bars (one per composite child)
    expect(screen.getAllByText("Materials").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Transport").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Packaging").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Cold storage").length).toBeGreaterThan(0);

    // Breakdown leaf row visible
    expect(screen.getByText("raw-material")).toBeInTheDocument();

    // SKU appears (breadcrumb + product card)
    expect(screen.getAllByText(/OFB-330/).length).toBeGreaterThan(0);
    // correlationId visible
    expect(screen.getByText(/corr-abc-123/)).toBeInTheDocument();
  });

  it("loading state shows 'Loading footprint…' before data resolves", () => {
    vi.mocked(productsApi.getProduct).mockReturnValue(new Promise(() => {}));
    vi.mocked(footprintsApi.getProductFootprint).mockReturnValue(new Promise(() => {}));

    renderWithProviders();

    expect(screen.getByText(/Loading footprint…/)).toBeInTheDocument();
  });

  it("422 error: shows inline 'Missing factor X' message and Retry button refetches", async () => {
    vi.mocked(productsApi.getProduct).mockResolvedValue(product);
    vi.mocked(footprintsApi.getProductFootprint).mockRejectedValueOnce(
      new ApiError(422, "Unprocessable Entity", {
        type: "about:blank",
        title: "Unprocessable Entity",
        status: 422,
        detail: "Missing factor X",
      }),
    );

    renderWithProviders();

    await waitFor(() =>
      expect(screen.getByText(/Missing factor X/)).toBeInTheDocument(),
    );

    // Retry button triggers refetch
    vi.mocked(footprintsApi.getProductFootprint).mockResolvedValueOnce(footprintResponse);
    const retryBtn = screen.getByRole("button", { name: /retry/i });
    await act(async () => {
      fireEvent.click(retryBtn);
    });

    await waitFor(() => expect(screen.getByText(/5\.370/)).toBeInTheDocument());
    expect(footprintsApi.getProductFootprint).toHaveBeenCalledTimes(2);
  });

  it("CSV export: clicking Export CSV downloads footprint-<correlationId>.csv", async () => {
    vi.mocked(productsApi.getProduct).mockResolvedValue(product);
    vi.mocked(footprintsApi.getProductFootprint).mockResolvedValue(footprintResponse);
    const blob = new Blob(["a,b\n1,2"], { type: "text/csv" });
    vi.mocked(footprintsApi.getFootprintCsvExport).mockResolvedValue(blob);

    renderWithProviders();

    await waitFor(() => expect(screen.getByText(/5\.370/)).toBeInTheDocument());

    const exportBtn = screen.getByRole("button", { name: /export/i });
    await act(async () => {
      fireEvent.click(exportBtn);
    });

    await waitFor(() =>
      expect(downloadUtil.downloadBlob).toHaveBeenCalledWith(
        blob,
        "footprint-corr-abc-123.csv",
      ),
    );

    const status = screen.getByText(/Downloaded footprint-corr-abc-123\.csv/);
    expect(status).toBeInTheDocument();
  });
});
